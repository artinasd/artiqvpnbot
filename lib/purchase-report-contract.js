const EXCLUDED_ORDER_TYPES = new Set(['wallet_topup', 'test']);

function isReportablePaidDelivery(order) {
  if (!order || typeof order !== 'object') return false;
  if (EXCLUDED_ORDER_TYPES.has(String(order.orderType || '').toLowerCase())) return false;
  if (String(order.planId || '').toLowerCase() === 'test') return false;
  if (order.walletCharged !== true || order.paymentStatus !== 'WALLET_PAID') return false;
  if (order.fulfillmentStatus !== 'FULFILLED' || order.deliveryStatus !== 'DELIVERED') return false;
  const amount = Number(order.walletChargedAmount ?? order.price ?? 0);
  return Number.isFinite(amount) && amount > 0;
}

module.exports = { isReportablePaidDelivery };
