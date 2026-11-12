/* surgespace.engspace.app · small, dependency-free behaviours */
(() => {
  const nav = document.getElementById('nav');
  const btn = document.getElementById('menubtn');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  onScroll(); addEventListener('scroll', onScroll, { passive: true });
  const close = () => { nav.classList.remove('open'); document.body.classList.remove('menu-open'); btn && btn.setAttribute('aria-expanded', 'false'); };
  if (btn) btn.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open); document.body.classList.toggle('menu-open', open); btn.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.mmenu a').forEach((a) => a.addEventListener('click', close));
  const mm = document.querySelector('.mmenu');
  if (mm) mm.addEventListener('click', (e) => { if (e.target === mm) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); hideLb(); } });

  // reveal on scroll
  const rv = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    rv.forEach((el) => io.observe(el));
  } else rv.forEach((el) => el.classList.add('in'));

  // tabs
  document.querySelectorAll('[role=tablist]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role=tab]')];
    const pick = (t, focus) => {
      tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
      if (focus) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
  });

  // lightbox for screenshots
  const lb = document.createElement('figure'); lb.className = 'lb'; lb.innerHTML = '<img alt=""><figcaption></figcaption>';
  document.body.appendChild(lb);
  function hideLb() { lb.classList.remove('on'); }
  lb.addEventListener('click', hideLb);
  document.querySelectorAll('.shot img').forEach((im) => im.addEventListener('click', () => {
    const big = im.dataset.full || im.currentSrc || im.src;
    lb.querySelector('img').src = big; lb.querySelector('img').alt = im.alt;
    lb.querySelector('figcaption').textContent = im.alt; lb.classList.add('on');
  }));

  // table of contents: highlight the section in view
  const toc = document.querySelector('.toc');
  if (toc && 'IntersectionObserver' in window) {
    const links = new Map([...toc.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { links.forEach((a) => a.classList.remove('on')); const a = links.get(e.target.id); if (a) a.classList.add('on'); }
    }), { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.prose h2[id]').forEach((h) => io.observe(h));
  }

  const yr = document.getElementById('yr'); if (yr) yr.textContent = String(new Date().getFullYear());

  // WhatsApp: a plain link to a chat with the founder; the number is put together here, not in the HTML
  (() => {
    const n = ['966', '54', '170', '6700'].join('');
    const pg = location.pathname.split('/').pop().replace(/\.html$/, '');
    const at = 'surgespace.engspace.app' + (pg && pg !== 'index' ? '/' + pg : '');
    const url = 'https://wa.me/' + n + '?text=' + encodeURIComponent('Hello, I have a question about SurgeSpace (' + at + ').');
    document.querySelectorAll('a[data-wa]').forEach((a) => { a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false; });
    if (document.body.dataset.nowa !== undefined) return;
    const a = document.createElement('a');
    a.className = 'wa-fab'; a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Chat with the founder on WhatsApp');
    a.innerHTML = '<span class="wa-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg></span><span class="wa-t"><b>Chat on WhatsApp</b><small>The founder · KSA working hours</small></span>';
    document.body.appendChild(a);
    setTimeout(() => a.classList.add('on'), 2400);
  })();
})();
