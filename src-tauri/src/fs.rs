use std::{
    fs::{create_dir_all, File},
    path::{Path, PathBuf},
};

use log::info;
use reqwest::{header::HeaderMap, Client};
use specta::Type;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::error::Error;
use crate::progress::update_progress;
use crate::AppState;

#[tauri::command]
#[specta::specta]
pub async fn download_file(
    id: String,
    url: String,
    path: PathBuf,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    token: Option<String>,
    finalize: Option<bool>,
    total_size: Option<u32>,
) -> Result<(), Error> {
    let finalize = finalize.unwrap_or(true);
    info!("Downloading file from {}", url);
    let client = Client::new();

    let mut req = client.get(&url);
    // add Bearer if token is present
    if let Some(token) = token {
        let mut header_map = HeaderMap::new();
        header_map.insert("Authorization", format!("Bearer {token}").parse().unwrap());
        req = req.headers(header_map);
    }
    let res = req.send().await?.error_for_status()?;
    let total_size = if let Some(total_size) = total_size {
        Some(total_size as u64)
    } else {
        res.content_length()
    };

    let url_path = reqwest::Url::parse(&url)
        .ok()
        .map(|parsed| parsed.path().to_ascii_lowercase())
        .unwrap_or_else(|| url.to_ascii_lowercase());
    let is_zip = url_path.ends_with(".zip");
    let is_tar = url_path.ends_with(".tar");
    let is_archive = is_zip || is_tar;

    let destination = Path::new(&path);
    let download_dir = if is_archive {
        destination
    } else {
        destination.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Download destination has no parent directory",
            )
        })?
    };
    create_dir_all(download_dir)?;

    let temporary = tempfile::NamedTempFile::new_in(download_dir)?;
    let (temporary_file, temporary_path) = temporary.into_parts();
    let mut output = tokio::fs::File::from_std(temporary_file);
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item?;
        output.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        if let Some(total_size) = total_size {
            let progress = ((downloaded as f32 / total_size as f32) * 100.0).min(100.0);
            update_progress(&state.progress_state, &app, id.clone(), progress, false)?;
        }
    }
    output.flush().await?;
    output.sync_all().await?;
    drop(output);

    info!("Downloaded file to {}", destination.display());

    if is_zip {
        unzip_file(destination, temporary_path.as_ref()).await?;
    } else if is_tar {
        let file = File::open(temporary_path.as_ref() as &Path)?;
        let mut archive = tar::Archive::new(file);
        archive.unpack(destination)?;
    } else {
        match std::fs::remove_file(destination) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        temporary_path
            .persist(destination)
            .map_err(|error| Error::from(error.error))?;
    }

    if finalize {
        update_progress(&state.progress_state, &app, id, 100.0, true)?;
    }
    // remove_file(&path).await;
    Ok(())
}

pub async fn unzip_file(path: &Path, archive_path: &Path) -> Result<(), Error> {
    let mut archive = zip::ZipArchive::new(File::open(archive_path)?)?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = path.join(file.mangled_name());
        if (*file.name()).ends_with('/') {
            info!(
                "File {} extracted to \"{}\"",
                i,
                outpath.as_path().display()
            );
            create_dir_all(&outpath)?;
        } else {
            info!(
                "File {} extracted to \"{}\" ({} bytes)",
                i,
                outpath.as_path().display(),
                file.size()
            );
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    create_dir_all(p)?;
                }
            }
            let mut outfile = std::fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn set_file_as_executable(_path: String) -> Result<(), Error> {
    #[cfg(unix)]
    {
        let path = Path::new(&_path);
        let metadata = std::fs::metadata(path)?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn file_exists(path: String) -> Result<bool, Error> {
    Ok(Path::new(&path).exists())
}

#[derive(Debug, Type, serde::Serialize)]
pub struct FileMetadata {
    pub last_modified: u32,
}

#[tauri::command]
#[specta::specta]
pub async fn get_file_metadata(path: String) -> Result<FileMetadata, Error> {
    let metadata = std::fs::metadata(path)?;
    let last_modified = metadata
        .modified()?
        .duration_since(std::time::SystemTime::UNIX_EPOCH)?;
    Ok(FileMetadata {
        last_modified: last_modified.as_secs() as u32,
    })
}
