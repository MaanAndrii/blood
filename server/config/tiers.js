const TIERS = {
  demo: {
    max_history_days: 30,
    export_pdf:  false,
    export_csv:  false,
    export_json: false,
    import_json: false,
  },
  premium: {
    max_history_days: null,
    export_pdf:  true,
    export_csv:  true,
    export_json: true,
    import_json: true,
  },
};

function getEffectiveTier(user) {
  if (!user) return 'demo';
  if (user.subscription_tier === 'demo') return 'demo';
  if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) return 'demo';
  return 'premium';
}

function getTierConfig(user) {
  return TIERS[getEffectiveTier(user)];
}

module.exports = { TIERS, getEffectiveTier, getTierConfig };
