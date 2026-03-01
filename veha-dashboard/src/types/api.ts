// === Pagination ===
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  per_page: number
}

// === Auth ===
export interface LoginRequest {
  username: string
  password: string
}

export interface UserResponse {
  id: string
  username: string
  role: string
  created_at: string
}

export interface CreateUser {
  username: string
  password: string
  role: string
}

export interface UpdateUser {
  username?: string
  role?: string
  password?: string
}

// === Boards ===
export interface Board {
  id: string
  name: string
  group_id: string | null
  status: string
  last_seen: string | null
  config: string
  created_at: string
  zone_id: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  board_type: string | null
  screen_width: number | null
  screen_height: number | null
  orientation: string | null
  sell_mode: string | null
  operating_hours_start: string | null
  operating_hours_end: string | null
}

export interface CreateBoard {
  name: string
  group_id?: string
}

export interface UpdateBoard {
  name?: string
  group_id?: string | null
  zone_id?: string | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  board_type?: string
  screen_width?: number | null
  screen_height?: number | null
  orientation?: string
  sell_mode?: string
  operating_hours_start?: string | null
  operating_hours_end?: string | null
}

export interface BoardFilter {
  zone_id?: string
  sell_mode?: string
  status?: string
  page?: number
  per_page?: number
}

// === Groups ===
export interface Group {
  id: string
  name: string
  created_at: string
}

export interface CreateGroup {
  name: string
}

// === Media ===
export interface Media {
  id: string
  name: string
  filename: string
  mime_type: string
  size: number
  uploaded_at: string
}

// === Playlists ===
export interface MediaItem {
  source: string
  duration: { secs: number; nanos: number } | null
  name: string | null
}

export interface PlaylistResponse {
  id: string
  name: string
  items: MediaItem[]
  loop_playlist: boolean
  created_at: string
  updated_at: string
}

export interface CreatePlaylist {
  name: string
  items: MediaItem[]
  loop_playlist?: boolean
}

// === Schedules ===
export interface Schedule {
  id: string
  board_id: string | null
  group_id: string | null
  playlist_id: string
  start_time: string | null
  end_time: string | null
  days_of_week: string
  priority: number
  created_at: string
}

export interface CreateSchedule {
  board_id?: string
  group_id?: string
  playlist_id: string
  start_time?: string
  end_time?: string
  days_of_week?: string
  priority?: number
}

// === Zones ===
export interface Zone {
  id: string
  name: string
  parent_id: string | null
  zone_type: string
  created_at: string
}

export interface ZoneDetail extends Zone {
  children: Zone[]
  board_count: number
}

export interface CreateZone {
  name: string
  parent_id?: string | null
  zone_type?: string
}

// === Advertisers ===
export interface Advertiser {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  is_house: boolean
  notes: string | null
  created_at: string
}

export interface CreateAdvertiser {
  name: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  notes?: string
}

// === Campaigns ===
export interface Campaign {
  id: string
  advertiser_id: string
  name: string
  status: string
  start_date: string
  end_date: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CreateCampaign {
  advertiser_id: string
  name: string
  start_date: string
  end_date: string
  notes?: string
}

export interface CampaignFilter {
  advertiser_id?: string
  status?: string
  page?: number
  per_page?: number
}

// === Creatives ===
export interface Creative {
  id: string
  campaign_id: string
  media_id: string
  name: string | null
  duration_secs: number | null
  status: string
  created_at: string
}

export interface CreateCreative {
  media_id: string
  name?: string
  duration_secs?: number
}

// === Bookings ===
export interface Booking {
  id: string
  campaign_id: string
  booking_type: string
  target_type: string
  target_id: string
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  days_of_week: string
  slot_duration_secs: number
  slots_per_loop: number
  priority: number
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CreateBooking {
  campaign_id: string
  booking_type: string
  target_type: string
  target_id: string
  start_date: string
  end_date: string
  start_time?: string
  end_time?: string
  days_of_week?: string
  slot_duration_secs?: number
  slots_per_loop?: number
  priority?: number
  notes?: string
}

export interface BookingFilter {
  campaign_id?: string
  target_type?: string
  status?: string
  page?: number
  per_page?: number
}

// === Play Logs ===
export interface PlayLog {
  id: string
  board_id: string
  booking_id: string | null
  creative_id: string | null
  media_id: string | null
  started_at: string
  ended_at: string | null
  duration_secs: number | null
  status: string
  created_at: string
}

export interface PlayLogFilter {
  board_id?: string
  booking_id?: string
  start_date?: string
  end_date?: string
  page?: number
  per_page?: number
}

export interface PlayLogSummary {
  date: string
  board_id: string
  booking_id: string | null
  play_count: number
  total_duration_secs: number
}

export interface PlayLogSummaryFilter {
  start_date?: string
  end_date?: string
}

// === Player Commands ===
export type PlayerCommand =
  | { type: 'Play' }
  | { type: 'Pause' }
  | { type: 'Resume' }
  | { type: 'Stop' }
  | { type: 'Next' }
  | { type: 'Previous' }
  | { type: 'LoadPlaylist'; data: string }
  | { type: 'GetStatus' }

export interface PlayerStatus {
  state: string
  current_item: string | null
  current_index: number
  total_items: number
  playlist_name: string | null
  active_booking_id: string | null
  active_creative_id: string | null
  uptime_secs: number | null
}

// === Resolved Schedule ===
export interface ResolvedItem {
  source: string
  name: string | null
  duration_secs: number | null
  booking_id: string | null
  creative_id: string | null
  media_id: string | null
}

export interface ResolvedPlaylist {
  board_id: string
  items: ResolvedItem[]
  active_booking_ids: string[]
  loop_playlist: boolean
}
