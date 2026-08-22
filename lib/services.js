const SERVICES = [
  { id: 'direct', name: 'Direct', label: '⚡ Direct', description: 'اکو / اقتصادی' },
  { id: 'tunnel', name: 'Tunnel', label: '🛡️ Tunnel', description: 'سرویس فعلی' },
  { id: 'gaming', name: 'Gaming', label: '🎮 Gaming', description: 'مخصوص بازی' },
];

function getService(id) {
  return SERVICES.find((service) => service.id === String(id)) || null;
}

function serviceButtons(prefix) {
  return SERVICES.map((service) => [
    { text: `${service.label} — ${service.description}`, callback_data: `${prefix}${service.id}` },
  ]);
}

module.exports = { SERVICES, getService, serviceButtons };
