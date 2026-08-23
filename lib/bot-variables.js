const VARIABLES = [
  { key: 'user_name', label: 'نام کاربر', example: 'علی' },
  { key: 'plan_name', label: 'نام پلن', example: 'Tunnel 30GB' },
  { key: 'price', label: 'قیمت', example: '250000' },
  { key: 'duration', label: 'مدت', example: '30 روز' },
  { key: 'traffic', label: 'حجم', example: '30GB' },
  { key: 'service_name', label: 'نام سرویس', example: 'Tunnel' },
  { key: 'sub_url', label: 'لینک اشتراک', example: 'https://example.com/sub/...' },
  { key: 'order_id', label: 'شماره سفارش', example: 'TG-20260823-AB12' },
  { key: 'card_number', label: 'شماره کارت', example: '6219861947080387' },
  { key: 'card_holder', label: 'نام صاحب کارت', example: 'اسعدی' },
  { key: 'username', label: 'نام اشتراک', example: 'user_123' },
  { key: 'expire', label: 'تاریخ انقضا', example: '2026-09-22' },
  { key: 'support_username', label: 'آیدی پشتیبانی', example: 'Your_Personal_ID' },
];

const VARIABLE_MAP = Object.fromEntries(VARIABLES.map((item) => [item.key, item]));

function variableToken(key) {
  return VARIABLE_MAP[key] ? `{${key}}` : null;
}

function listVariables() {
  return VARIABLES.map((item) => ({ ...item, token: `{${item.key}}` }));
}

function interpolate(template, values = {}) {
  return String(template ?? '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return values[key] === undefined || values[key] === null ? `{${key}}` : String(values[key]);
  });
}

module.exports = { VARIABLES, VARIABLE_MAP, variableToken, listVariables, interpolate };
