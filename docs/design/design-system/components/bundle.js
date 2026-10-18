/* @ds-bundle: {"format":4,"namespace":"FYD","components":[{"name":"Button"},{"name":"Badge"},{"name":"Card"},{"name":"Field"},{"name":"UrgencyNotice"},{"name":"TestimonyCard"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) { if (arguments[i]) o.push(arguments[i]); } return o.join(' '); }

  // 24px stroke icons in the Lucide style. In the app, import the same names from lucide-react.
  var ICONS = {
    check: ['M20 6 9 17l-5-5'],
    'check-circle': ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'm9 12 2 2 4-4'],
    'octagon-alert': ['M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z', 'M12 8v4', 'M12 16h.01'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
    'map-pin': ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    mic: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'],
    shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4']
  };
  function Icon(p) {
    var paths = ICONS[p.name] || [];
    var labelled = !!p.title;
    return h('svg', { className: cx('fyd-icon', p.className), viewBox: '0 0 24 24', 'aria-hidden': labelled ? undefined : 'true', role: labelled ? 'img' : undefined, 'aria-label': p.title },
      paths.map(function (d, i) { return h('path', { key: i, d: d }); }));
  }

  function Button(p) {
    var variant = p.variant || 'primary', size = p.size, loading = p.loading;
    var cls = cx('fyd', 'fyd-btn', 'fyd-btn--' + variant, size && size !== 'md' ? 'fyd-btn--' + size : '', p.block ? 'fyd-btn--block' : '', p.className);
    var kids = [loading ? h('span', { key: 's', className: 'fyd-spin', 'aria-hidden': 'true' }) : (p.icon ? h(Icon, { key: 'i', name: p.icon }) : null), h('span', { key: 't' }, p.children)];
    if (p.href) return h('a', { className: cls, href: p.href, 'aria-disabled': p.disabled ? 'true' : undefined }, kids);
    return h('button', { className: cls, type: p.type || 'button', disabled: p.disabled || loading, 'aria-busy': loading ? 'true' : undefined, onClick: p.onClick }, kids);
  }

  var BADGE_ICON = { success: 'check', warning: 'clock', danger: 'octagon-alert', info: 'info' };
  function Badge(p) {
    var v = p.variant || 'neutral';
    var ic = p.icon === false ? null : (p.icon || BADGE_ICON[v]);
    return h('span', { className: cx('fyd', 'fyd-badge', 'fyd-badge--' + v, p.className) }, ic ? h(Icon, { name: ic }) : null, p.children);
  }

  function Card(p) {
    var Tag = p.as || 'section';
    var role = p.variant === 'emergency' ? 'alert' : undefined;
    return h(Tag, { className: cx('fyd', 'fyd-card', p.variant ? 'fyd-card--' + p.variant : '', p.className), role: role, 'aria-labelledby': p.labelledBy }, p.children);
  }

  function Field(p) {
    var id = p.id || 'fyd-field', hintId = id + '-hint', errId = id + '-err';
    var describedBy = [p.error ? errId : null, p.hint ? hintId : null].filter(Boolean).join(' ') || undefined;
    return h('div', { className: cx('fyd', 'fyd-field', p.className) },
      h('label', { className: 'fyd-label', htmlFor: id }, p.label),
      h('textarea', { id: id, className: 'fyd-input', rows: p.rows || 4, name: p.name, placeholder: p.placeholder, maxLength: p.maxLength, defaultValue: p.defaultValue, disabled: p.disabled, 'aria-invalid': p.error ? 'true' : undefined, 'aria-describedby': describedBy }),
      p.hint ? h('p', { id: hintId, className: 'fyd-hint' }, p.hint) : null,
      p.error ? h('p', { id: errId, className: 'fyd-error' }, h(Icon, { name: 'octagon-alert' }), p.error) : null);
  }

  var TIER_ICON = { darurat: 'octagon-alert', segera: 'clock', terjadwal: 'calendar', rutin: 'check-circle' };
  function UrgencyNotice(p) {
    var tier = p.tier || 'rutin';
    return h('div', { className: cx('fyd', 'fyd-notice', 'fyd-notice--' + tier, p.className), role: tier === 'darurat' ? 'alert' : undefined },
      h(Icon, { name: TIER_ICON[tier] }),
      h('span', null, h('span', { className: 'fyd-notice__label' }, p.label), h('span', { className: 'fyd-notice__desc' }, p.description)));
  }

  function TestimonyCard(p) {
    var id = p.id || 'fyd-testi';
    return h('article', { className: cx('fyd', 'fyd-testi', p.className), 'aria-labelledby': id },
      h('header', null,
        h('div', { className: 'fyd-testi__head' },
          h('h3', { id: id, className: 'fyd-testi__name' }, h('a', { href: p.href || '#' }, p.providerName)),
          p.verified ? h(Badge, { variant: 'success' }, p.verifiedLabel || 'Kunjungan terverifikasi') : null),
        h('p', { className: 'fyd-testi__meta' }, p.meta)),
      h('dl', { className: 'fyd-rates', 'aria-label': p.ratingsLabel || 'Nilai' },
        (p.ratings || []).map(function (r) {
          return h('div', { key: r.label, className: 'fyd-rate' }, h('dt', null, r.label), h('dd', null, h(Icon, { name: 'star' }), r.score + '/5'));
        })),
      h('p', { className: 'fyd-testi__text' }, p.excerpt),
      (p.procedure || p.price) ? h('dl', { className: 'fyd-testi__facts' },
        p.procedure ? [h('dt', { key: 'a' }, 'Tindakan:'), h('dd', { key: 'b' }, p.procedure)] : null,
        p.price ? [h('dt', { key: 'c' }, 'Biaya:'), h('dd', { key: 'd' }, p.price)] : null) : null,
      h('footer', { className: 'fyd-testi__foot' }, h('span', null, p.byline), h('a', { className: 'fyd-link', href: p.href || '#' }, p.readMore || 'Baca selengkapnya')));
  }

  window.FYD = { Icon: Icon, Button: Button, Badge: Badge, Card: Card, Field: Field, UrgencyNotice: UrgencyNotice, TestimonyCard: TestimonyCard };
})();
