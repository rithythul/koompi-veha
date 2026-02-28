use crate::db;
use sqlx::SqlitePool;

/// A resolved media item for the playlist sent to agents.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolvedItem {
    pub source: String,
    pub name: Option<String>,
    pub duration_secs: Option<u32>,
    pub booking_id: Option<String>,
    pub creative_id: Option<String>,
    pub media_id: Option<String>,
}

/// The resolved playlist for a board.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolvedPlaylist {
    pub board_id: String,
    pub items: Vec<ResolvedItem>,
    pub active_booking_ids: Vec<String>,
    pub loop_playlist: bool,
}

/// Resolve what a board should play right now based on active bookings.
pub async fn resolve_for_board(
    pool: &SqlitePool,
    board_id: &str,
) -> Result<ResolvedPlaylist, Box<dyn std::error::Error + Send + Sync>> {
    // Get board info
    let board = match db::get_board(pool, board_id).await? {
        Some(b) => b,
        None => {
            return Ok(ResolvedPlaylist {
                board_id: board_id.to_string(),
                items: vec![],
                active_booking_ids: vec![],
                loop_playlist: true,
            });
        }
    };

    // Use Board struct fields directly
    let sell_mode = board.sell_mode.as_deref().unwrap_or("house_only");

    if sell_mode == "house_only" {
        return Ok(ResolvedPlaylist {
            board_id: board_id.to_string(),
            items: vec![],
            active_booking_ids: vec![],
            loop_playlist: true,
        });
    }

    let now = chrono::Utc::now();
    let today = now.format("%Y-%m-%d").to_string();
    let current_time = now.format("%H:%M").to_string();

    // Get zone ancestry for this board
    let zone_ids: Vec<String> = match &board.zone_id {
        Some(zid) => db::get_zone_ancestry(pool, zid).await.unwrap_or_default(),
        None => vec![],
    };

    // Get group_id
    let group_id = board.group_id.as_deref();

    // Get active bookings
    let bookings = db::get_active_bookings_for_board(
        pool, board_id, &zone_ids, group_id, &today, &current_time,
    )
    .await?;

    if bookings.is_empty() {
        return Ok(ResolvedPlaylist {
            board_id: board_id.to_string(),
            items: vec![],
            active_booking_ids: vec![],
            loop_playlist: true,
        });
    }

    let mut items = Vec::new();
    let mut booking_ids = Vec::new();

    // Check for exclusive bookings (highest priority exclusive wins)
    let exclusive = bookings.iter().find(|b| b.booking_type == "exclusive");

    if let Some(excl) = exclusive {
        let creatives = db::get_approved_creatives(pool, &excl.campaign_id).await?;
        for c in &creatives {
            items.push(ResolvedItem {
                source: format!("/api/media/{}/download", c.media_id),
                name: c.name.clone(),
                duration_secs: c.duration_secs.map(|s| s as u32),
                booking_id: Some(excl.id.clone()),
                creative_id: Some(c.id.clone()),
                media_id: Some(c.media_id.clone()),
            });
        }
        booking_ids.push(excl.id.clone());
    } else {
        // Rotation: build weighted loop
        for booking in &bookings {
            if booking.booking_type != "rotation" {
                continue;
            }
            let creatives = db::get_approved_creatives(pool, &booking.campaign_id).await?;
            let slot_dur = booking.slot_duration_secs as u32;

            for _ in 0..booking.slots_per_loop {
                for c in &creatives {
                    items.push(ResolvedItem {
                        source: format!("/api/media/{}/download", c.media_id),
                        name: c.name.clone(),
                        duration_secs: c.duration_secs.map(|s| s as u32).or(Some(slot_dur)),
                        booking_id: Some(booking.id.clone()),
                        creative_id: Some(c.id.clone()),
                        media_id: Some(c.media_id.clone()),
                    });
                }
            }
            booking_ids.push(booking.id.clone());
        }
    }

    Ok(ResolvedPlaylist {
        board_id: board_id.to_string(),
        items,
        active_booking_ids: booking_ids,
        loop_playlist: true,
    })
}
