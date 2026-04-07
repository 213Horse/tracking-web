import type { Request } from 'express';

/** Số dòng mỗi trang tối đa (preview / success). */
export const COMMERCE_LIST_PAGE_MAX = 500;

/** Số event tối đa dùng tính bảng xếp hạng sản phẩm (mới nhất trước). */
export const COMMERCE_RANK_SCAN_DEFAULT = 25_000;
export const COMMERCE_RANK_SCAN_MAX = 100_000;

export type CommercePreviewItem = {
  id: string;
  visitorId: string;
  customerLabel: string;
  customerTitle: string;
  at: string;
  products: string[];
};

export type CommerceSuccessItem = {
  id: string;
  visitorId: string;
  customerLabel: string;
  customerTitle: string;
  at: string;
  orderNo: string;
};

export type ProductRankRow = { name: string; count: number };

function customerFromSession(session: {
  visitorId: string;
  visitor: {
    identityMapping?: {
      user?: { name?: string | null; email?: string | null; erpId?: string | null } | null;
    } | null;
  };
}): { label: string; title: string } {
  const user = session.visitor.identityMapping?.user;
  const label =
    (user?.name && String(user.name).trim()) || user?.email || 'Chưa định danh';
  const title = [
    user?.name,
    user?.email,
    user?.erpId ? `Mã KH: ${user.erpId}` : null,
    `Visitor: ${session.visitorId}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return { label, title };
}

export function mapCheckoutPreviewEvent(e: {
  id: string;
  timestamp: Date;
  properties: unknown;
  session: {
    visitorId: string;
    visitor: {
      identityMapping?: {
        user?: { name?: string | null; email?: string | null; erpId?: string | null } | null;
      } | null;
    };
  };
}): CommercePreviewItem {
  const props = e.properties as Record<string, unknown> | null;
  const products = Array.isArray(props?.productNames)
    ? (props!.productNames as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const { label, title } = customerFromSession(e.session);
  return {
    id: e.id,
    visitorId: e.session.visitorId,
    customerLabel: label,
    customerTitle: title,
    at: e.timestamp.toISOString(),
    products,
  };
}

export function mapCheckoutSuccessEvent(e: {
  id: string;
  timestamp: Date;
  properties: unknown;
  session: {
    visitorId: string;
    visitor: {
      identityMapping?: {
        user?: { name?: string | null; email?: string | null; erpId?: string | null } | null;
      } | null;
    };
  };
}): CommerceSuccessItem {
  const props = e.properties as Record<string, unknown> | null;
  const { label, title } = customerFromSession(e.session);
  return {
    id: e.id,
    visitorId: e.session.visitorId,
    customerLabel: label,
    customerTitle: title,
    at: e.timestamp.toISOString(),
    orderNo: props?.orderNo != null ? String(props.orderNo) : '',
  };
}

/** Đếm mỗi lần tên SP xuất hiện trong properties.productNames (mảng). */
export function tallyProductNamesFromPropertiesRows(
  rows: { properties: unknown }[],
  propKey: string
): ProductRankRow[] {
  const map = new Map<string, number>();
  for (const e of rows) {
    const props = e.properties as Record<string, unknown> | null;
    const arr = props?.[propKey];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function parseCommercePageParams(
  req: Request,
  prefix: 'preview' | 'success'
): { pageNumber: number; pageSize: number } {
  const pnKey = prefix === 'preview' ? 'previewPageNumber' : 'successPageNumber';
  const psKey = prefix === 'preview' ? 'previewPageSize' : 'successPageSize';
  let pageNumber = parseInt(String(req.query[pnKey] ?? '1'), 10);
  if (Number.isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
  let pageSize = parseInt(String(req.query[psKey] ?? '25'), 10);
  if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 25;
  pageSize = Math.min(pageSize, COMMERCE_LIST_PAGE_MAX);
  return { pageNumber, pageSize };
}

export function parseRankEventsLimit(req: Request): number {
  let v = parseInt(String(req.query.rankEventsLimit ?? ''), 10);
  if (Number.isNaN(v) || v < 1) v = COMMERCE_RANK_SCAN_DEFAULT;
  return Math.min(v, COMMERCE_RANK_SCAN_MAX);
}
