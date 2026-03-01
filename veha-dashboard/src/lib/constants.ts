export const SELL_MODES = [
  { value: 'house_only', label: 'House Only' },
  { value: 'rotation', label: 'Rotation' },
  { value: 'exclusive', label: 'Exclusive' },
] as const

export const BOARD_TYPES = [
  { value: 'led_billboard', label: 'LED Billboard' },
  { value: 'lcd_display', label: 'LCD Display' },
  { value: 'projector', label: 'Projector' },
] as const

export const ORIENTATIONS = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
] as const

export const ZONE_TYPES = [
  { value: 'country', label: 'Country' },
  { value: 'province', label: 'Province' },
  { value: 'district', label: 'District' },
  { value: 'custom', label: 'Custom' },
] as const

export const CAMPAIGN_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
] as const

export const BOOKING_TYPES = [
  { value: 'exclusive', label: 'Exclusive' },
  { value: 'rotation', label: 'Rotation' },
] as const

export const TARGET_TYPES = [
  { value: 'board', label: 'Board' },
  { value: 'zone', label: 'Zone' },
  { value: 'group', label: 'Group' },
] as const

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const
