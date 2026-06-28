const DEMO_DAYS = 7;

const TIERS = {
  admin: {
    max_history_days: null,
    export_pdf:   true,
    export_csv:   true,
    export_json:  true,
    import_json:  true,
    drive_backup: true,
  },
  demo: {
    max_history_days: null,
    export_pdf:   true,
    export_csv:   true,
    export_json:  true,
    import_json:  true,
    drive_backup: true,
  },
  premium: {
    max_history_days: null,
    export_pdf:   true,
    export_csv:   true,
    export_json:  true,
    import_json:  true,
    drive_backup: true,
  },
  free: {
    max_history_days: 30,
    export_pdf:   false,
    export_csv:   false,
    export_json:  false,
    import_json:  false,
    drive_backup: false,
  },
};

function getEffectiveTier(user) {
  if (!user) return 'free';
  const tier = user.subscription_tier;

  if (tier === 'admin') return 'admin';

  if (tier === 'demo') {
    const created = user.created_at ? new Date(user.created_at) : null;
    if (created) {
      const expiry = new Date(created.getTime() + DEMO_DAYS * 24 * 60 * 60 * 1000);
      if (new Date() < expiry) return 'demo';
    }
    return 'free';
  }

  if (tier === 'free') return 'free';

  if (tier === 'premium') {
    if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) {
      return 'free';
    }
    return 'premium';
  }

  return 'free';
}

function getTierConfig(user) {
  return TIERS[getEffectiveTier(user)];
}

module.exports = { TIERS, DEMO_DAYS, getEffectiveTier, getTierConfig };
