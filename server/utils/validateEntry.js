// Returns an error string if the entry fields are invalid, or null if valid.
function validateEntry(morning, evening, weight) {
  const inRange = (v, min, max) =>
    v == null || (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max);

  const fields = [
    ['morning.sys_l',   morning.sys_l,   70, 220], ['morning.dia_l',   morning.dia_l,   50, 130],
    ['morning.sys_r',   morning.sys_r,   70, 220], ['morning.dia_r',   morning.dia_r,   50, 130],
    ['morning.pulse',   morning.pulse,   30, 200],
    ['morning.pulse_l', morning.pulse_l, 30, 200],
    ['morning.pulse_r', morning.pulse_r, 30, 200],
    ['evening.sys_l',   evening.sys_l,   70, 220], ['evening.dia_l',   evening.dia_l,   50, 130],
    ['evening.sys_r',   evening.sys_r,   70, 220], ['evening.dia_r',   evening.dia_r,   50, 130],
    ['evening.pulse',   evening.pulse,   30, 200],
    ['evening.pulse_l', evening.pulse_l, 30, 200],
    ['evening.pulse_r', evening.pulse_r, 30, 200],
  ];
  for (const [name, val, min, max] of fields) {
    if (!inRange(val, min, max)) return `${name} must be between ${min} and ${max}`;
  }

  const pairs = [
    ['morning.sys_l/dia_l', morning.sys_l, morning.dia_l],
    ['morning.sys_r/dia_r', morning.sys_r, morning.dia_r],
    ['evening.sys_l/dia_l', evening.sys_l, evening.dia_l],
    ['evening.sys_r/dia_r', evening.sys_r, evening.dia_r],
  ];
  for (const [label, sys, dia] of pairs) {
    if (sys != null && dia != null && Number(sys) <= Number(dia)) {
      return `${label}: systolic must be greater than diastolic`;
    }
  }

  if (weight != null && (isNaN(weight) || weight < 20 || weight > 300)) {
    return 'weight must be between 20 and 300 kg';
  }

  return null;
}

module.exports = { validateEntry };
