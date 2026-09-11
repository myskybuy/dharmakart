/** Branded, human-facing order reference — DB id (`order.id`) is unchanged. */
export function orderCode(id: number) {
  return `DK-ORD-${String(id).padStart(6, "0")}`;
}
