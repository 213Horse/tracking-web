/**
 * Traffic Peak Hours — cùng quy ước với dashboard:
 * ma trận 7×24, hàng 0 = Thứ 2 … hàng 6 = Chủ nhật, cột 0–23 = giờ theo Asia/Ho_Chi_Minh.
 * Mỗi session đếm 1 lần tại thời điểm startedAt.
 */

export const TRAFFIC_PEAK_TIMEZONE = 'Asia/Ho_Chi_Minh';

const DAY_LABELS_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

/** en-US short weekday → JS getDay() (0=CN … 6=Thứ 7) */
function weekdayEnShortToJsDay(w: string | undefined): number {
  switch (w) {
    case 'Sun':
      return 0;
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    default:
      return 0;
  }
}

/**
 * Map startedAt → ô heatmap: row 0..6 (T2..CN), col 0..23.
 */
export function sessionStartedAtToPeakCell(startedAt: Date): { row: number; col: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TRAFFIC_PEAK_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(startedAt);
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  const hourPart = parts.find((p) => p.type === 'hour')?.value;
  const jsDay = weekdayEnShortToJsDay(wd);
  const row = jsDay === 0 ? 6 : jsDay - 1;
  let col = parseInt(hourPart ?? '0', 10);
  if (Number.isNaN(col) || col < 0) col = 0;
  if (col > 23) col = 23;
  return { row, col };
}

export function buildTrafficPeakMatrix(startedAts: Date[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of startedAts) {
    const { row, col } = sessionStartedAtToPeakCell(t);
    grid[row][col] += 1;
  }
  return grid;
}

export function matrixMaxCount(grid: number[][]): number {
  let m = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > m) m = v;
    }
  }
  return m;
}

export function trafficPeakDayLabelsVi(): string[] {
  return [...DAY_LABELS_VI];
}
