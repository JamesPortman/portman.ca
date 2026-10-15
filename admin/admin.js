// portman.ca admin dashboard. The page sits behind middleware.js's Basic auth,
// and /admin/stats (rewritten to /api/stats) is fetched inside that login.
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var chart, donut, recentRows = [], showAll = false;

  var ACTION_LABELS = {
    painting_click: 'Artwork clicked',
    app_open: 'App opened',
    screenshot_open: 'Screenshot opened',
    section_open: 'Tab opened',
    outbound_click: 'Outbound link',
    email_click: 'Email link',
  };
  var APP_NAMES = { 'terra-incognita': 'Terra Incognita', 'no-exit': 'No Exit', 'beyond-doubt': 'Beyond Doubt', 'worldcup': 'World Cup pool' };
  var SECTION_NAMES = { apps: 'Claude Apps', media: 'Media', paintings: 'Paintings' };

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }

  // "products/blue-mountain-sunset-painting" -> "Blue Mountain Sunset (painting)"
  function artworkName(t){
    var parts = String(t).split('/'), kind = parts[0] === 'photographs' ? 'photo' : 'painting';
    var words = (parts[1] || '').replace(/-(painting|photo)$/, '').split('-').filter(Boolean);
    return words.map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ') + ' (' + kind + ')';
  }

  // A table of label + count, each row with a bar scaled to the largest value.
  function rows(el, data, labelOf, empty){
    el.innerHTML = data.length ? '' : '<tr><td class="muted">' + (empty || 'No data yet') + '</td></tr>';
    var max = Math.max.apply(null, [1].concat(data.map(function(d){ return d.c; })));
    data.forEach(function(d){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="bar"><div class="fill" style="width:' + Math.round(d.c / max * 100) + '%"></div><span>' +
        esc(labelOf(d)) + '</span></td><td class="n">' + d.c.toLocaleString() + '</td>';
      el.appendChild(tr);
    });
  }

  // "+20%" / "-20%" / "new" against the previous period of the same length.
  function delta(el, cur, prev){
    el.className = 'delta';
    if (prev === null || prev === undefined) { el.textContent = ''; return; }
    if (prev === 0) { el.textContent = cur > 0 ? '▲ new vs previous period' : '— vs previous period'; if (cur > 0) el.classList.add('up'); return; }
    var pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) { el.textContent = '0% vs previous period'; return; }
    el.textContent = (pct > 0 ? '▲ +' : '▼ ') + pct + '% vs previous period';
    el.classList.add(pct > 0 ? 'up' : 'down');
  }

  // Days with no traffic come back missing; fill them so the x-axis doesn't skip.
  function fillDays(byDay, days, now){
    if (!days) return byDay;
    var map = {}; byDay.forEach(function(d){ map[d.day] = d; });
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var day = new Date(now - i * 864e5).toISOString().slice(0, 10);
      out.push(map[day] || { day: day, views: 0, visitors: 0 });
    }
    return out;
  }

  function targetLabel(e){
    if (!e.target) return '';
    if (e.action === 'painting_click') return artworkName(e.target);
    if (e.action === 'app_open') return APP_NAMES[e.target] || e.target;
    if (e.action === 'section_open') return SECTION_NAMES[e.target] || e.target;
    return e.target;
  }

  function renderRecent(){
    var el = $('t-recent'), more = $('more');
    if (!recentRows.length) { el.innerHTML = '<tr><td class="muted">No activity yet</td></tr>'; more.classList.add('hidden'); return; }
    el.innerHTML = '<tr><th>Time</th><th>Event</th><th>Page</th><th>Device</th><th>Location</th></tr>';
    (showAll ? recentRows : recentRows.slice(0, 15)).forEach(function(e){
      var tr = document.createElement('tr');
      var when = new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      var ev = e.kind === 'action'
        ? '<span class="tag">' + esc(ACTION_LABELS[e.action] || e.action) + '</span>' + (e.target ? ' <span class="muted">' + esc(targetLabel(e)) + '</span>' : '')
        : '<span class="muted">page view</span>';
      var dev = esc(e.device || '') + (e.browser ? ' <span class="muted">· ' + esc(e.browser) + '</span>' : '');
      var loc = [e.city, e.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">unknown</span>';
      tr.innerHTML = '<td class="muted">' + esc(when) + '</td><td>' + ev + '</td><td>' + esc(e.path) + '</td><td>' + dev + '</td><td>' + loc + '</td>';
      el.appendChild(tr);
    });
    if (recentRows.length > 15) { more.classList.remove('hidden'); more.textContent = showAll ? 'Show less' : 'Show all ' + recentRows.length; }
    else more.classList.add('hidden');
  }

  function showStatus(html){ $('status').innerHTML = html; $('status').classList.remove('hidden'); $('content').classList.add('hidden'); }

  function load(){
    return fetch('/admin/stats?days=' + $('range').value, { cache: 'no-store' }).then(function(res){
      if (res.status === 503) {
        showStatus('<h2>Database not connected yet</h2><p>The dashboard needs a Postgres database. In Vercel, open the <code>portman-ca</code> project → <strong>Storage</strong> → <strong>Create Database</strong> → <strong>Neon</strong>, connect it to the project, then redeploy. Visits start counting from then.</p>');
        return;
      }
      if (!res.ok) { showStatus('<h2>Couldn’t load stats</h2><p>The stats endpoint answered ' + res.status + '. Try refreshing.</p>'); return; }
      return res.json().then(render);
    }).catch(function(){ showStatus('<h2>Couldn’t load stats</h2><p>Check your connection and refresh.</p>'); });
  }

  function render(d){
    $('status').classList.add('hidden');
    $('content').classList.remove('hidden');
    $('m-unique').textContent = d.unique.toLocaleString();
    $('m-views').textContent = d.views.toLocaleString();
    $('m-actions').textContent = d.actions.toLocaleString();
    delta($('d-unique'), d.unique, d.prev && d.prev.unique);
    delta($('d-views'), d.views, d.prev && d.prev.views);
    delta($('d-actions'), d.actions, d.prev && d.prev.actions);
    $('updated').textContent = 'Updated ' + new Date().toLocaleString();

    rows($('t-paths'), d.topPaths, function(x){ return x.path; });
    rows($('t-sections'), d.sections, function(x){ return SECTION_NAMES[x.section] || x.section; }, 'No tabs opened yet');
    rows($('t-actions'), d.actionBreakdown, function(x){ return ACTION_LABELS[x.action] || x.action; }, 'No actions recorded yet');
    rows($('t-browsers'), d.browsers, function(x){ return x.browser; });
    rows($('t-paintings'), d.paintings, function(x){ return artworkName(x.target); }, 'No artwork clicked yet');
    rows($('t-apps'), d.apps, function(x){ return APP_NAMES[x.app] || x.app; }, 'No apps opened yet');
    rows($('t-ref'), d.topReferrers, function(x){ return x.ref; }, 'No referrers yet');
    rows($('t-country'), d.topCountries, function(x){ return x.country; });
    recentRows = d.recent; showAll = false; renderRecent();

    var series = fillDays(d.byDay, d.days, d.now);
    var axis = { color: '#8A847A' }, grid = { color: 'rgba(42,39,36,.07)' };
    if (chart) chart.destroy();
    chart = new Chart($('chart'), {
      type: 'line',
      data: { labels: series.map(function(x){ return x.day; }), datasets: [
        { label: 'Visitors', data: series.map(function(x){ return x.visitors; }), borderColor: '#B4502A', backgroundColor: 'rgba(180,80,42,.12)', fill: true, tension: .3, pointRadius: 2 },
        { label: 'Views', data: series.map(function(x){ return x.views; }), borderColor: '#5C574F', borderDash: [4, 4], fill: false, tension: .3, pointRadius: 0 }
      ]},
      options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: '#5C574F', boxWidth: 12 } } },
        scales: { x: { ticks: Object.assign({ maxTicksLimit: 8 }, axis), grid: grid },
                  y: { beginAtZero: true, ticks: Object.assign({ precision: 0 }, axis), grid: grid } } }
    });

    if (donut) donut.destroy();
    donut = new Chart($('devices'), {
      type: 'doughnut',
      data: { labels: d.devices.map(function(x){ return x.device || 'unknown'; }),
        datasets: [{ data: d.devices.map(function(x){ return x.c; }), backgroundColor: ['#B4502A', '#5C574F', '#C9A227', '#3F7A4E'], borderColor: '#FAF7F0', borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: '#5C574F', boxWidth: 12 } } } }
    });
  }

  // "Don't count this browser": assets/track.js checks this flag before sending anything.
  function excluded(){ try { return localStorage.getItem('pc_no_track') === '1'; } catch (_) { return false; } }
  function renderExclusion(){
    var off = excluded();
    $('ex-status').textContent = off ? '✓ This browser is not counted.' : 'This browser is currently counted.';
    $('ex-toggle').textContent = off ? 'Count this browser again' : 'Don’t count this browser';
    $('ex-toggle').className = off ? 'btn ghost' : 'btn';
  }
  $('ex-toggle').addEventListener('click', function(){
    try {
      if (excluded()) localStorage.removeItem('pc_no_track'); else localStorage.setItem('pc_no_track', '1');
    } catch (_) { $('ex-status').textContent = 'This browser blocks site storage, so it can’t be excluded.'; return; }
    renderExclusion();
  });

  $('range').addEventListener('change', load);
  $('refresh').addEventListener('click', load);
  $('more').addEventListener('click', function(){ showAll = !showAll; renderRecent(); });

  renderExclusion();
  load();
})();
