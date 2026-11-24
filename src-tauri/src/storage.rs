use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON serialization/deserialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Could not resolve %APPDATA% directory")]
    DataDirUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoQuality {
    #[serde(rename = "480p")]
    Q480p,
    #[serde(rename = "720p")]
    Q720p,
    #[serde(rename = "1080p")]
    Q1080p,
}

impl Default for VideoQuality {
    fn default() -> Self {
        Self::Q720p
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetronomeSyncMode {
    TrackGrid,
    LoopStart,
    Standalone,
}

impl Default for MetronomeSyncMode {
    fn default() -> Self {
        Self::TrackGrid
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetronomeConfig {
    pub enabled: bool,
    pub bpm: f64,
    pub beats_per_bar: u8,
    pub beat_unit: u8,
    pub subdivision: u8,
    pub accent_first_beat: bool,
    pub sync_mode: MetronomeSyncMode,
    pub offset_sec: f64,
    pub volume: f64,
}

impl Default for MetronomeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bpm: 120.0,
            beats_per_bar: 4,
            beat_unit: 4,
            subdivision: 1,
            accent_first_beat: true,
            sync_mode: MetronomeSyncMode::TrackGrid,
            offset_sec: 0.0,
            volume: 0.7,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopSegment {
    pub id: String,
    pub name: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub youtube_id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: f64,
    pub thumbnail_url: String,
    pub loops: Vec<LoopSegment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metronome: Option<MetronomeConfig>,
    pub created_at: String,
    pub last_played_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    pub schema_version: u32,
    pub songs: Vec<Song>,
}

impl Default for LibraryData {
    fn default() -> Self {
        Self {
            schema_version: 1,
            songs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyAction {
    TogglePlay,
    ToggleLoop,
    JumpToA,
    SeekBack,
    SeekForward,
    SpeedDown,
    SpeedUp,
    SpeedReset,
    PrevLoop,
    NextLoop,
    ToggleMetronome,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub schema_version: u32,
    pub video_quality: VideoQuality,
    pub global_hotkeys_enabled: bool,
    pub local_hotkeys: BTreeMap<HotkeyAction, String>,
    pub global_hotkeys: BTreeMap<HotkeyAction, String>,
    pub volume: f64,
}

impl Default for AppSettings {
    fn default() -> Self {
        let local_hotkeys = BTreeMap::from([
            (HotkeyAction::TogglePlay, "Space".to_string()),
            (HotkeyAction::ToggleLoop, "L".to_string()),
            (HotkeyAction::JumpToA, "R".to_string()),
            (HotkeyAction::SeekBack, "ArrowLeft".to_string()),
            (HotkeyAction::SeekForward, "ArrowRight".to_string()),
            (HotkeyAction::SpeedDown, "-".to_string()),
            (HotkeyAction::SpeedUp, "=".to_string()),
            (HotkeyAction::SpeedReset, "0".to_string()),
            (HotkeyAction::PrevLoop, "[".to_string()),
            (HotkeyAction::NextLoop, "]".to_string()),
            (HotkeyAction::ToggleMetronome, "M".to_string()),
        ]);

        let global_hotkeys = BTreeMap::from([
            (HotkeyAction::TogglePlay, "Ctrl+Alt+Space".to_string()),
            (HotkeyAction::ToggleLoop, "Ctrl+Alt+L".to_string()),
            (HotkeyAction::JumpToA, "Ctrl+Alt+R".to_string()),
            (HotkeyAction::SeekBack, "Ctrl+Alt+Left".to_string()),
            (HotkeyAction::SeekForward, "Ctrl+Alt+Right".to_string()),
            (HotkeyAction::SpeedDown, "Ctrl+Alt+-".to_string()),
            (HotkeyAction::SpeedUp, "Ctrl+Alt+=".to_string()),
            (HotkeyAction::SpeedReset, "Ctrl+Alt+0".to_string()),
            (HotkeyAction::PrevLoop, "Ctrl+Alt+[".to_string()),
            (HotkeyAction::NextLoop, "Ctrl+Alt+]".to_string()),
            (HotkeyAction::ToggleMetronome, "Ctrl+Alt+M".to_string()),
        ]);

        Self {
            schema_version: 1,
            video_quality: VideoQuality::Q720p,
            global_hotkeys_enabled: false,
            local_hotkeys,
            global_hotkeys,
            volume: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    Merge,
    Replace,
}

pub fn app_data_dir() -> Result<PathBuf, StorageError> {
    dirs::config_dir()
        .map(|base| base.join("GuitarLooper"))
        .ok_or(StorageError::DataDirUnavailable)
}

/// Atomically writes serialized JSON via a sibling temporary file + fsync + rename.
pub fn atomic_write_json<T: Serialize>(path: &Path, data: &T) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let bytes = serde_json::to_vec_pretty(data)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("data.json");
    let tmp_name = format!("{file_name}.{}.{nanos}.tmp", std::process::id());
    let tmp_path = path.with_file_name(tmp_name);

    let write_res = (|| -> Result<(), StorageError> {
        let mut file = File::create(&tmp_path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(err) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Err(err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(err.into());
    }

    Ok(())
}

/// Reads and deserializes a JSON file, returning T::default() only if the file does not exist.
pub fn read_json_or_default<T: DeserializeOwned + Default>(
    path: &Path,
) -> Result<T, StorageError> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(T::default()),
        Err(err) => Err(err.into()),
    }
}

pub fn import_library(
    mut existing: LibraryData,
    incoming: LibraryData,
    mode: ImportMode,
) -> LibraryData {
    match mode {
        ImportMode::Replace => LibraryData {
            schema_version: 1,
            songs: incoming.songs,
        },
        ImportMode::Merge => {
            for inc_song in incoming.songs {
                if let Some(target) = existing
                    .songs
                    .iter_mut()
                    .find(|s| s.youtube_id == inc_song.youtube_id)
                {
                    let existing_loop_ids: HashSet<String> =
                        target.loops.iter().map(|l| l.id.clone()).collect();
                    for lp in inc_song.loops {
                        if !existing_loop_ids.contains(&lp.id) {
                            target.loops.push(lp);
                        }
                    }
                } else {
                    existing.songs.push(inc_song);
                }
            }
            existing.schema_version = 1;
            existing
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_song(youtube_id: &str, title: &str, loops: Vec<LoopSegment>) -> Song {
        Song {
            id: format!("song-{youtube_id}"),
            youtube_id: youtube_id.to_string(),
            url: format!("https://www.youtube.com/watch?v={youtube_id}"),
            title: title.to_string(),
            channel: "Guitar Channel".to_string(),
            duration_sec: 180.0,
            thumbnail_url: "https://example.com/thumb.jpg".to_string(),
            loops,
            metronome: None,
            created_at: "2026-11-24T20:00:00Z".to_string(),
            last_played_at: "2026-11-24T20:00:00Z".to_string(),
        }
    }

    fn sample_loop(id: &str, name: &str, start_sec: f64, end_sec: f64) -> LoopSegment {
        LoopSegment {
            id: id.to_string(),
            name: name.to_string(),
            start_sec,
            end_sec,
            created_at: "2026-11-24T20:00:00Z".to_string(),
        }
    }

    #[test]
    fn atomic_write_creates_and_reads_back() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("library.json");

        let default_read: LibraryData = read_json_or_default(&path).unwrap();
        assert_eq!(default_read, LibraryData::default());

        let mut song = sample_song(
            "dQw4w9WgXcQ",
            "Test Song",
            vec![sample_loop("l1", "Intro", 0.0, 12.5)],
        );
        song.metronome = Some(MetronomeConfig::default());

        let data = LibraryData {
            schema_version: 1,
            songs: vec![song],
        };

        atomic_write_json(&path, &data).unwrap();
        let loaded: LibraryData = read_json_or_default(&path).unwrap();
        assert_eq!(loaded, data);
    }

    #[test]
    fn atomic_write_overwrites_without_leaving_temp_files() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut settings = AppSettings::default();
        atomic_write_json(&path, &settings).unwrap();

        settings.video_quality = VideoQuality::Q1080p;
        settings.global_hotkeys_enabled = true;
        atomic_write_json(&path, &settings).unwrap();

        let loaded: AppSettings = read_json_or_default(&path).unwrap();
        assert_eq!(loaded, settings);

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["settings.json"]);
    }

    #[test]
    fn corrupted_json_returns_error_and_preserves_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("library.json");
        let corrupted = "{ invalid json";
        fs::write(&path, corrupted).unwrap();

        let err = read_json_or_default::<LibraryData>(&path).unwrap_err();
        assert!(matches!(err, StorageError::Json(_)));
        assert_eq!(fs::read_to_string(&path).unwrap(), corrupted);
    }

    #[test]
    fn import_merge_deduplicates_songs_and_loops() {
        let existing = LibraryData {
            schema_version: 1,
            songs: vec![sample_song(
                "vidA1234567",
                "Song A",
                vec![sample_loop("l1", "Intro", 0.0, 10.0)],
            )],
        };

        let incoming = LibraryData {
            schema_version: 1,
            songs: vec![
                sample_song(
                    "vidA1234567",
                    "Song A Duplicate",
                    vec![
                        sample_loop("l1", "Intro Modified", 1.0, 9.0),
                        sample_loop("l2", "Solo", 30.0, 45.5),
                    ],
                ),
                sample_song(
                    "vidB1234567",
                    "Song B",
                    vec![sample_loop("l3", "Riff", 5.0, 15.0)],
                ),
            ],
        };

        let merged = import_library(existing, incoming, ImportMode::Merge);
        assert_eq!(merged.songs.len(), 2);
        assert_eq!(merged.songs[0].title, "Song A");
        assert_eq!(merged.songs[0].loops.len(), 2);
        assert_eq!(merged.songs[0].loops[0].name, "Intro");
        assert_eq!(merged.songs[0].loops[1].id, "l2");
        assert_eq!(merged.songs[1].youtube_id, "vidB1234567");
    }

    #[test]
    fn import_replace_replaces_entire_library() {
        let existing = LibraryData {
            schema_version: 1,
            songs: vec![sample_song("vidA1234567", "Old Song", vec![])],
        };
        let incoming = LibraryData {
            schema_version: 1,
            songs: vec![sample_song("vidB1234567", "New Song", vec![])],
        };

        let replaced = import_library(existing, incoming.clone(), ImportMode::Replace);
        assert_eq!(replaced, incoming);
    }
}
