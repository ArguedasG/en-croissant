use std::{
    fs::File,
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

use memmap2::Mmap;
use rayon::prelude::*;
use rkyv::validation::{archive::ArchiveValidator, ArchiveContext};
use rkyv::{Archive, Deserialize, Serialize};

/// Preserve rkyv's bounds/alignment validation while allowing cancellation inside legacy archives.
struct CancellableArchive<'a> {
    inner: ArchiveValidator<'a>,
    cancelled: &'a dyn Fn() -> bool,
}

// SAFETY: Every pointer/range check is forwarded unchanged to ArchiveValidator.
// Cancellation only adds an earlier error; it never approves an unchecked pointer.
unsafe impl ArchiveContext<rkyv::rancor::Error> for CancellableArchive<'_> {
    fn check_subtree_ptr(
        &mut self,
        ptr: *const u8,
        layout: &std::alloc::Layout,
    ) -> Result<(), rkyv::rancor::Error> {
        if (self.cancelled)() {
            return Err(<rkyv::rancor::Error as rkyv::rancor::Source>::new(
                io::Error::new(io::ErrorKind::Interrupted, "Search stopped"),
            ));
        }
        self.inner.check_subtree_ptr(ptr, layout)
    }
    unsafe fn push_subtree_range(
        &mut self,
        root: *const u8,
        end: *const u8,
    ) -> Result<std::ops::Range<usize>, rkyv::rancor::Error> {
        // SAFETY: Forwarding the caller's identical range and preconditions.
        unsafe { self.inner.push_subtree_range(root, end) }
    }
    unsafe fn pop_subtree_range(
        &mut self,
        range: std::ops::Range<usize>,
    ) -> Result<(), rkyv::rancor::Error> {
        // SAFETY: Range came from the same underlying validator.
        unsafe { self.inner.pop_subtree_range(range) }
    }
}

const MAGIC: &[u8; 4] = b"ECSI";
const VERSION: u32 = 5;
pub const INDEX_BATCH_SIZE: usize = 4096;
const HEADER_SIZE: usize = 8;

fn verify_header(header: &[u8]) -> io::Result<()> {
    if header.len() < HEADER_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "File too small for header",
        ));
    }

    if &header[0..4] != MAGIC {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid magic bytes",
        ));
    }

    let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
    if version != VERSION && version != 4 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Unsupported version: {} (expected {})", version, VERSION),
        ));
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Archive, Serialize, Deserialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
#[repr(u8)]
pub enum GameResult {
    None = 0,
    WhiteWin = 1,
    BlackWin = 2,
    Draw = 3,
    Other = 4,
}

impl GameResult {
    pub fn from_str(s: Option<&str>) -> Self {
        match s {
            Some("1-0") => GameResult::WhiteWin,
            Some("0-1") => GameResult::BlackWin,
            Some("1/2-1/2") => GameResult::Draw,
            Some(_) => GameResult::Other,
            None => GameResult::None,
        }
    }

    pub fn to_str(self) -> Option<&'static str> {
        match self {
            GameResult::None => None,
            GameResult::WhiteWin => Some("1-0"),
            GameResult::BlackWin => Some("0-1"),
            GameResult::Draw => Some("1/2-1/2"),
            GameResult::Other => Some("*"),
        }
    }
}

#[derive(Debug, Clone, Archive, Serialize, Deserialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SearchGameEntry {
    pub id: i32,
    pub white_id: i32,
    pub black_id: i32,
    pub date: Option<String>,
    pub result: GameResult,
    pub pawn_home: u16,
    pub white_material: u8,
    pub black_material: u8,
    pub white_elo: i16,
    pub black_elo: i16,
    pub fen: Option<String>,
    pub moves: Vec<u8>,
}

#[derive(Archive, Serialize, Deserialize)]
pub struct SearchIndex {
    pub entries: Vec<SearchGameEntry>,
}

impl SearchIndex {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Vec::with_capacity(capacity),
        }
    }

    pub fn push(&mut self, entry: SearchGameEntry) {
        self.entries.push(entry);
    }

    pub fn write_to<P: AsRef<Path>>(&self, path: P) -> io::Result<()> {
        let mut writer = SearchIndexWriter::new(path.as_ref())?;
        for entries in self.entries.chunks(INDEX_BATCH_SIZE) {
            writer.write_batch(&SearchIndex {
                entries: entries.to_vec(),
            })?;
        }
        writer.finish()
    }
}

impl Default for SearchIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SearchGameEntryRef<'a> {
    pub id: i32,
    pub white_id: i32,
    pub black_id: i32,
    pub date: Option<&'a str>,
    pub result: GameResult,
    pub pawn_home: u16,
    pub white_material: u8,
    pub black_material: u8,
    pub white_elo: i16,
    pub black_elo: i16,
    pub fen: Option<&'a str>,
    pub moves: &'a [u8],
}

impl<'a> From<&'a ArchivedSearchGameEntry> for SearchGameEntryRef<'a> {
    fn from(archived: &'a ArchivedSearchGameEntry) -> Self {
        Self {
            id: archived.id.into(),
            white_id: archived.white_id.into(),
            black_id: archived.black_id.into(),
            date: archived.date.as_ref().map(|s| s.as_str()),
            result: match archived.result {
                ArchivedGameResult::None => GameResult::None,
                ArchivedGameResult::WhiteWin => GameResult::WhiteWin,
                ArchivedGameResult::BlackWin => GameResult::BlackWin,
                ArchivedGameResult::Draw => GameResult::Draw,
                ArchivedGameResult::Other => GameResult::Other,
            },
            pawn_home: archived.pawn_home.into(),
            white_material: archived.white_material,
            black_material: archived.black_material,
            white_elo: archived.white_elo.into(),
            black_elo: archived.black_elo.into(),
            fen: archived.fen.as_ref().map(|s| s.as_str()),
            moves: &archived.moves,
        }
    }
}

impl SearchGameEntry {
    pub fn from_game_data(
        id: i32,
        white_id: i32,
        black_id: i32,
        date: Option<String>,
        result: Option<String>,
        moves: Vec<u8>,
        fen: Option<String>,
        pawn_home: i32,
        white_material: i32,
        black_material: i32,
        white_elo: Option<i32>,
        black_elo: Option<i32>,
    ) -> Self {
        Self {
            id,
            white_id,
            black_id,
            date,
            result: GameResult::from_str(result.as_deref()),
            pawn_home: pawn_home as u16,
            white_material: white_material as u8,
            black_material: black_material as u8,
            white_elo: white_elo.unwrap_or(0) as i16,
            black_elo: black_elo.unwrap_or(0) as i16,
            fen,
            moves,
        }
    }
}

/// Independent archive blocks bound construction memory. Publication never truncates a live mmap.
pub struct SearchIndexWriter {
    file: tempfile::NamedTempFile,
    destination: PathBuf,
    count: u64,
}
impl SearchIndexWriter {
    pub fn new(destination: &Path) -> io::Result<Self> {
        Self::with_source(destination, "")
    }
    pub fn with_source(destination: &Path, source: &str) -> io::Result<Self> {
        let mut file =
            tempfile::NamedTempFile::new_in(destination.parent().unwrap_or(Path::new(".")))?;
        file.write_all(MAGIC)?;
        file.write_all(&VERSION.to_le_bytes())?;
        file.write_all(&0u64.to_le_bytes())?;
        file.write_all(&(source.len() as u64).to_le_bytes())?;
        file.write_all(source.as_bytes())?;
        file.write_all(&[0; 8][..(8 - source.len() % 8) % 8])?;
        Ok(Self {
            file,
            destination: destination.to_path_buf(),
            count: 0,
        })
    }
    pub fn write_batch(&mut self, batch: &SearchIndex) -> io::Result<()> {
        let bytes = rkyv::to_bytes::<rkyv::rancor::Error>(batch)
            .map_err(|e| io::Error::other(e.to_string()))?;
        self.file.write_all(&(bytes.len() as u64).to_le_bytes())?;
        self.file.write_all(&bytes)?;
        self.file.write_all(&[0; 8][..(8 - bytes.len() % 8) % 8])?;
        self.count += batch.entries.len() as u64;
        Ok(())
    }
    pub fn finish(mut self) -> io::Result<()> {
        self.file.seek(SeekFrom::Start(8))?;
        self.file.write_all(&self.count.to_le_bytes())?;
        self.file.as_file().sync_all()?;
        self.file.persist(&self.destination).map_err(|e| e.error)?;
        Ok(())
    }
}
#[derive(Clone)]
pub struct MmapSearchIndex {
    mmap: Arc<Mmap>,
    blocks: Arc<Vec<(std::ops::Range<usize>, usize)>>,
    count: usize,
    file_revision: (u64, std::time::SystemTime),
}
impl MmapSearchIndex {
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        Self::open_checked(path, &|| false)
    }

    pub fn open_checked<P: AsRef<Path>>(path: P, cancelled: &dyn Fn() -> bool) -> io::Result<Self> {
        let file = File::open(path)?;
        let metadata = file.metadata()?;
        let file_revision = (metadata.len(), metadata.modified()?);
        let mmap = unsafe { Mmap::map(&file)? };
        verify_header(&mmap)?;
        let version = u32::from_le_bytes(mmap[4..8].try_into().unwrap());
        let mut blocks = Vec::new();
        let mut count = 0usize;
        let mut validate = |range: std::ops::Range<usize>| -> io::Result<()> {
            if cancelled() {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "Search stopped"));
            }
            let bytes = mmap.get(range.clone()).ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidData, "Truncated search index")
            })?;
            let mut context = CancellableArchive {
                inner: ArchiveValidator::new(bytes),
                cancelled,
            };
            let archive = rkyv::api::access_with_context::<
                ArchivedSearchIndex,
                _,
                rkyv::rancor::Error,
            >(bytes, &mut context)
            .map_err(|e| {
                io::Error::new(
                    if cancelled() {
                        io::ErrorKind::Interrupted
                    } else {
                        io::ErrorKind::InvalidData
                    },
                    e.to_string(),
                )
            })?;
            blocks.push((range, count));
            count = count
                .checked_add(archive.entries.len())
                .ok_or_else(|| io::Error::other("Index too large"))?;
            Ok(())
        };
        if version == 4 {
            validate(HEADER_SIZE..mmap.len())?;
        } else {
            if mmap.len() < 24 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Missing index count",
                ));
            }
            let expected = u64::from_le_bytes(mmap[8..16].try_into().unwrap());
            let source_len = u64::from_le_bytes(mmap[16..24].try_into().unwrap());
            if source_len > 4096 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid source stamp",
                ));
            }
            let mut offset = 24 + source_len as usize + (8 - source_len as usize % 8) % 8;
            if offset > mmap.len() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Truncated source stamp",
                ));
            }
            while offset < mmap.len() {
                let size = mmap.get(offset..offset + 8).ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Missing block size")
                })?;
                let length = usize::try_from(u64::from_le_bytes(size.try_into().unwrap()))
                    .map_err(|_| io::Error::other("Block too large"))?;
                offset += 8;
                let end = offset
                    .checked_add(length)
                    .filter(|end| *end <= mmap.len())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::InvalidData, "Invalid block length")
                    })?;
                validate(offset..end)?;
                offset = end
                    .checked_add((8 - length % 8) % 8)
                    .filter(|end| *end <= mmap.len())
                    .ok_or_else(|| {
                        io::Error::new(io::ErrorKind::InvalidData, "Truncated padding")
                    })?;
            }
            if count as u64 != expected {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Index count mismatch",
                ));
            }
        }
        Ok(Self {
            mmap: Arc::new(mmap),
            blocks: Arc::new(blocks),
            count,
            file_revision,
        })
    }
    pub fn is_current(&self, path: &Path) -> bool {
        std::fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok().map(|t| (m.len(), t)))
            .is_some_and(|revision| revision == self.file_revision)
    }
    pub fn len(&self) -> usize {
        self.count
    }
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
    fn block(&self, range: &std::ops::Range<usize>) -> &ArchivedSearchIndex {
        // Validated by open_checked; our writer publishes by replacement, never in-place.
        unsafe { rkyv::access_unchecked::<ArchivedSearchIndex>(&self.mmap[range.clone()]) }
    }
    pub fn get_entry_ref(&self, index: usize) -> Option<SearchGameEntryRef<'_>> {
        if index >= self.count {
            return None;
        }
        let block = self.blocks.partition_point(|(_, start)| *start <= index) - 1;
        let (range, start) = &self.blocks[block];
        self.block(range)
            .entries
            .get(index - start)
            .map(SearchGameEntryRef::from)
    }
    pub fn iter(&self) -> impl Iterator<Item = SearchGameEntryRef<'_>> {
        self.blocks.iter().flat_map(|(range, _)| {
            self.block(range)
                .entries
                .iter()
                .map(SearchGameEntryRef::from)
        })
    }
    pub fn par_iter(&self) -> impl ParallelIterator<Item = SearchGameEntryRef<'_>> + '_ {
        self.blocks.par_iter().flat_map(|(range, _)| {
            self.block(range)
                .entries
                .par_iter()
                .map(SearchGameEntryRef::from)
        })
    }
    pub fn is_valid<P: AsRef<Path>>(path: P) -> bool {
        let path = path.as_ref();
        if !path.exists() {
            return false;
        }

        let Ok(file) = File::open(path) else {
            return false;
        };

        let mut header = [0u8; HEADER_SIZE];
        let mut reader = BufReader::new(file);
        if reader.read_exact(&mut header).is_err() {
            return false;
        }

        verify_header(&header).is_ok()
    }

    #[allow(dead_code)]
    pub fn is_up_to_date<P: AsRef<Path>>(db_path: P) -> bool {
        let db_path = db_path.as_ref();
        let index_path = get_index_path(db_path);

        if !Self::is_valid(&index_path) {
            return false;
        }

        if let Ok(mut file) = File::open(&index_path) {
            let mut header = [0; 24];
            if file.read_exact(&mut header).is_ok()
                && u32::from_le_bytes(header[4..8].try_into().unwrap()) == VERSION
            {
                let length = u64::from_le_bytes(header[16..24].try_into().unwrap());
                if length > 4096 {
                    return false;
                }
                if length > 0 {
                    let mut stamp = vec![0; length as usize];
                    if file.read_exact(&mut stamp).is_err() {
                        return false;
                    }
                    return super::position_query::source_stamp(db_path)
                        .is_ok_and(|source| source.as_bytes() == stamp);
                }
            }
        }

        let Ok(db_meta) = std::fs::metadata(db_path) else {
            return false;
        };
        let Ok(index_meta) = std::fs::metadata(&index_path) else {
            return false;
        };

        let Ok(db_modified) = db_meta.modified() else {
            return false;
        };
        let Ok(index_modified) = index_meta.modified() else {
            return false;
        };

        let mut wal_path = db_path.as_os_str().to_os_string();
        wal_path.push("-wal");
        let wal_current = match std::fs::metadata(PathBuf::from(wal_path)) {
            Ok(meta) => meta.len() == 0 || meta.modified().is_ok_and(|time| time <= index_modified),
            Err(error) => error.kind() == io::ErrorKind::NotFound,
        };
        index_modified >= db_modified && wal_current
    }
}

pub fn get_index_path(db_path: &Path) -> PathBuf {
    db_path.with_extension("ecsi")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.ecsi");

        // Create test entries
        let entries = vec![
            SearchGameEntry {
                id: 1,
                white_id: 100,
                black_id: 200,
                date: Some("2024.01.15".to_string()),
                result: GameResult::WhiteWin,
                pawn_home: 0xFFFF,
                white_material: 39,
                black_material: 39,
                white_elo: 2700,
                black_elo: 2650,
                fen: None,
                moves: vec![12, 12, 9, 9], // e4 e5 Nf3 Nc6
            },
            SearchGameEntry {
                id: 2,
                white_id: 150,
                black_id: 250,
                date: None,
                result: GameResult::Draw,
                pawn_home: 0xF0F0,
                white_material: 30,
                black_material: 28,
                white_elo: 0,
                black_elo: 2400,
                fen: Some(
                    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2".to_string(),
                ),
                moves: vec![15, 10],
            },
        ];

        // Write
        let index = SearchIndex {
            entries: entries.clone(),
        };
        index.write_to(&path).unwrap();

        // Verify valid
        assert!(MmapSearchIndex::is_valid(&path));

        // Read back using mmap
        let index = MmapSearchIndex::open(&path).unwrap();
        assert_eq!(index.len(), entries.len());

        for (i, original) in entries.iter().enumerate() {
            let loaded = index.get_entry_ref(i).unwrap();
            assert_eq!(loaded.id, original.id);
            assert_eq!(loaded.white_id, original.white_id);
            assert_eq!(loaded.black_id, original.black_id);
            assert_eq!(loaded.result, original.result);
            assert_eq!(loaded.pawn_home, original.pawn_home);
            assert_eq!(loaded.white_material, original.white_material);
            assert_eq!(loaded.black_material, original.black_material);
            assert_eq!(loaded.fen, original.fen.as_deref());
            assert_eq!(loaded.moves, original.moves);
        }

        // Test iterator
        let loaded_vec: Vec<_> = index.iter().collect();
        assert_eq!(loaded_vec.len(), entries.len());
    }

    #[test]
    fn test_game_result_encoding() {
        assert_eq!(GameResult::from_str(Some("1-0")), GameResult::WhiteWin);
        assert_eq!(GameResult::from_str(Some("0-1")), GameResult::BlackWin);
        assert_eq!(GameResult::from_str(Some("1/2-1/2")), GameResult::Draw);
        assert_eq!(GameResult::from_str(Some("*")), GameResult::Other);
        assert_eq!(GameResult::from_str(None), GameResult::None);

        assert_eq!(GameResult::WhiteWin.to_str(), Some("1-0"));
        assert_eq!(GameResult::BlackWin.to_str(), Some("0-1"));
        assert_eq!(GameResult::Draw.to_str(), Some("1/2-1/2"));
        assert_eq!(GameResult::None.to_str(), None);
    }

    #[test]
    fn test_large_index() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("large.ecsi");

        let results = [
            GameResult::None,
            GameResult::WhiteWin,
            GameResult::BlackWin,
            GameResult::Draw,
            GameResult::Other,
        ];

        // Create many entries
        let mut index = SearchIndex::with_capacity(5000);
        for i in 0..5000 {
            index.push(SearchGameEntry {
                id: i,
                white_id: i * 2,
                black_id: i * 2 + 1,
                date: if i % 2 == 0 {
                    Some("2024.01.15".to_string())
                } else {
                    None
                },
                result: results[(i % 5) as usize],
                pawn_home: 0xFFFF,
                white_material: 39,
                black_material: 39,
                white_elo: 2000 + (i % 800) as i16,
                black_elo: 1900 + (i % 700) as i16,
                fen: if i % 3 == 0 {
                    Some("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1".to_string())
                } else {
                    None
                },
                moves: vec![12, 12, 9, 9],
            });
        }
        index.write_to(&path).unwrap();

        // Load with mmap
        let index = MmapSearchIndex::open(&path).unwrap();
        assert_eq!(index.len(), 5000);
        assert_eq!(index.get_entry_ref(4095).unwrap().id, 4095);
        assert_eq!(index.get_entry_ref(4096).unwrap().id, 4096);
        assert_eq!(index.iter().count(), 5000);
        assert_eq!(index.par_iter().count(), 5000);

        // Verify random access
        let entry = index.get_entry_ref(500).unwrap();
        assert_eq!(entry.id, 500);
        assert_eq!(entry.white_id, 1000);
        assert_eq!(entry.black_id, 1001);
    }

    #[test]
    fn test_parallel_iteration() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("parallel.ecsi");

        let mut index = SearchIndex::with_capacity(100);
        for i in 0..100 {
            index.push(SearchGameEntry {
                id: i,
                white_id: i,
                black_id: i,
                date: None,
                result: GameResult::None,
                pawn_home: 0,
                white_material: 0,
                black_material: 0,
                white_elo: 0,
                black_elo: 0,
                fen: None,
                moves: vec![],
            });
        }
        index.write_to(&path).unwrap();

        let mmap_index = MmapSearchIndex::open(&path).unwrap();

        // Test parallel iteration
        let sum: i32 = mmap_index.par_iter().map(|e| e.id).sum();
        assert_eq!(sum, (0..100i32).sum::<i32>());
    }

    #[test]
    fn test_index_becomes_stale_when_database_changes() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("games.db3");
        std::fs::write(&db_path, b"database-v1").unwrap();

        let index_path = get_index_path(&db_path);
        SearchIndex::default().write_to(&index_path).unwrap();
        assert!(MmapSearchIndex::is_up_to_date(&db_path));

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&db_path, b"database-v2").unwrap();
        assert!(!MmapSearchIndex::is_up_to_date(&db_path));
    }

    #[test]
    fn legacy_archives_are_validated_and_chunk_validation_is_cancellable() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("legacy.ecsi");
        let mut bytes = MAGIC.to_vec();
        bytes.extend(4u32.to_le_bytes());
        bytes.extend(
            rkyv::to_bytes::<rkyv::rancor::Error>(&SearchIndex::default())
                .unwrap()
                .iter(),
        );
        std::fs::write(&legacy, &bytes).unwrap();
        assert!(MmapSearchIndex::open(&legacy).unwrap().is_empty());
        bytes.truncate(8);
        std::fs::write(&legacy, bytes).unwrap();
        assert!(MmapSearchIndex::is_valid(&legacy));
        assert_eq!(
            MmapSearchIndex::open(&legacy).err().unwrap().kind(),
            io::ErrorKind::InvalidData
        );

        let blocks = dir.path().join("blocks.ecsi");
        let mut writer = SearchIndexWriter::new(&blocks).unwrap();
        writer.write_batch(&SearchIndex::default()).unwrap();
        writer.write_batch(&SearchIndex::default()).unwrap();
        writer.finish().unwrap();
        let calls = std::cell::Cell::new(0);
        let result = MmapSearchIndex::open_checked(&blocks, &|| {
            calls.set(calls.get() + 1);
            calls.get() >= 2
        });
        assert_eq!(result.err().unwrap().kind(), io::ErrorKind::Interrupted);
    }
}
