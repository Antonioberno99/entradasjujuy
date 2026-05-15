const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const action = process.argv[2] || 'snapshot';

async function getPage() {
  const targets = await fetch('http://127.0.0.1:9222/json').then((r) => r.json());
  const page = targets.find((t) => t.type === 'page' && t.url.includes('dashboard.render.com')) || targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No page target found');
  return page;
}

async function withCdp(fn) {
  const page = await getPage();
  const sock = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const onMessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id !== requestId) return;
      sock.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    };
    sock.addEventListener('message', onMessage);
    sock.send(JSON.stringify({ id: requestId, method, params }));
  });

  await new Promise((resolve) => sock.addEventListener('open', resolve, { once: true }));
  await send('Runtime.enable');
  try {
    return await fn(send);
  } finally {
    sock.close();
  }
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime exception');
  return result.result.value;
}

async function waitFor(send, expression, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await evaluate(send, expression).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function typeInto(send, selector, value) {
  await evaluate(send, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    el.select && el.select();
    return true;
  })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', windowsVirtualKeyCode: 17 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', windowsVirtualKeyCode: 17 });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await send('Input.insertText', { text: value });
  await evaluate(send, `document.activeElement && document.activeElement.dispatchEvent(new Event('change', { bubbles:true }))`);
}

function parseEnvFile(filePath) {
  const env = {};
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const actions = {
  snapshot: (send) => evaluate(send, `({
    url: location.href,
    title: document.title,
    text: document.body.innerText.slice(0, 6000)
  })`),
  reload: async (send) => {
    await send('Page.reload', { ignoreCache: true });
    return { ok:true };
  },
  goto: async (send) => {
    await send('Page.navigate', { url: process.argv[3] });
    return { ok:true, url:process.argv[3] };
  },
  clickPostgres: (send) => evaluate(send, `(() => {
    const els = [...document.querySelectorAll('button,a,[role=button]')];
    const el = els.find(e => /New Postgres/i.test(e.innerText || e.textContent || ''));
    if (!el) return { ok:false, buttons: els.slice(0, 40).map(e => (e.innerText || e.textContent || '').trim()) };
    el.click();
    return { ok:true, text:(el.innerText || el.textContent || '').trim() };
  })()`),
  clickNew: (send) => evaluate(send, `(() => {
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(e => /^New$/i.test((e.innerText || e.textContent || '').trim()));
    if (!el) return { ok:false };
    el.click();
    return { ok:true, text:(el.innerText || el.textContent || '').trim() };
  })()`),
  clickWebService: (send) => evaluate(send, `(() => {
    const els = [...document.querySelectorAll('button,a,[role=button]')];
    const el = els.find(e => /New Web Service|^Web Service$/i.test((e.innerText || e.textContent || '').trim()));
    if (!el) return { ok:false, buttons: els.slice(0, 40).map(e => (e.innerText || e.textContent || '').trim()) };
    el.click();
    return { ok:true, text:(el.innerText || el.textContent || '').trim() };
  })()`),
  inspectFields: (send) => evaluate(send, `(() => ({
    inputs: [...document.querySelectorAll('input,textarea,select')].map((el, i) => ({
      i,
      tag: el.tagName,
      type: el.type || '',
      name: el.name || '',
      placeholder: el.placeholder || '',
      value: el.value || '',
      aria: el.getAttribute('aria-label') || '',
      id: el.id || ''
    })),
    buttons: [...document.querySelectorAll('button,a,[role=button]')].map((el, i) => ({
      i,
      text: (el.innerText || el.textContent || '').trim().slice(0, 120),
      tag: el.tagName,
      disabled: !!el.disabled
    })).filter(x => x.text)
  }))()`),
  fillPostgres: (send) => evaluate(send, `(() => {
    const inputs = [...document.querySelectorAll('input')];
    const set = (el, value) => {
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:value }));
      el.dispatchEvent(new Event('change', { bubbles:true }));
      el.blur();
      return true;
    };
    set(document.getElementById('name') || inputs[0], 'entradasjujuy-db');
    set(document.getElementById('databaseName') || inputs[1], 'entradasjujuy');
    set(document.getElementById('databaseUser') || inputs[2], 'entradasjujuy_user');
    const els = [...document.querySelectorAll('button,a,[role=button],label,div')];
    const free = els.find(e => /^Free\\b/i.test((e.innerText || e.textContent || '').trim()));
    if (free) free.click();
    return { ok:true, values: inputs.slice(0,3).map(i => i.value), clickedFree: !!free };
  })()`),
  planHtml: (send) => evaluate(send, `(() => [...document.querySelectorAll('button')]
    .filter(b => /(Free|Basic|Create Database)/i.test(b.innerText || b.textContent || ''))
    .map((b, i) => ({ i, text:(b.innerText || b.textContent || '').trim(), aria:b.getAttribute('aria-pressed'), cls:b.className, disabled:b.disabled, html:b.outerHTML.slice(0,500) })))()`),
  clickFreePlan: (send) => evaluate(send, `(() => {
    const free = [...document.querySelectorAll('button')].find(b => b.getAttribute('name') === 'Free' || /^Free\\b/i.test((b.innerText || '').trim()));
    if (!free) return { ok:false };
    free.scrollIntoView({ block:'center' });
    free.click();
    return { ok:true, text:(free.innerText || '').trim(), html:free.outerHTML.slice(0,300) };
  })()`),
  clickCreateDatabase: (send) => evaluate(send, `(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /Create Database/i.test(b.innerText || b.textContent || ''));
    if (!btn) return { ok:false };
    btn.scrollIntoView({ block:'center' });
    btn.click();
    return { ok:true, text:(btn.innerText || '').trim() };
  })()`),
  clickText: (send) => evaluate(send, `(() => {
    const target = ${JSON.stringify(process.argv[3] || '')};
    const els = [...document.querySelectorAll('button,a,[role=button]')];
    const el = els.find(e => (e.innerText || e.textContent || '').trim() === target) ||
      els.find(e => (e.innerText || e.textContent || '').includes(target));
    if (!el) return { ok:false, target, candidates: els.map(e => (e.innerText || e.textContent || '').trim()).filter(Boolean).slice(0,80) };
    el.scrollIntoView({ block:'center' });
    el.click();
    return { ok:true, text:(el.innerText || el.textContent || '').trim(), url:location.href };
  })()`),
  githubInstallInspect: (send) => evaluate(send, `(() => ({
    url: location.href,
    inputs: [...document.querySelectorAll('input,select')].map((el, i) => ({
      i, type:el.type, name:el.name, value:el.type === 'hidden' ? '[hidden]' : el.value, checked:el.checked, id:el.id,
      label: el.closest('label')?.innerText || document.querySelector('label[for="'+el.id+'"]')?.innerText || ''
    })),
    buttons: [...document.querySelectorAll('button,input[type=submit],a')].map((el, i) => ({
      i, text:(el.innerText || el.value || el.textContent || '').trim(), type:el.type || '', disabled:!!el.disabled
    })).filter(x => x.text)
  }))()`),
  githubSelectOnlyRepos: (send) => evaluate(send, `(() => {
    const input = document.querySelector('#install_target_selected, input[name="install_target"][value="selected"]');
    if (!input) return { ok:false };
    input.scrollIntoView({ block:'center' });
    input.click();
    return { ok:true, checked:input.checked, text:document.body.innerText.slice(0, 3000) };
  })()`),
  githubRepoInspect: (send) => evaluate(send, `(() => ({
    url: location.href,
    text: document.body.innerText.slice(0, 5000),
    inputs: [...document.querySelectorAll('input,select,textarea')].map((el, i) => ({
      i,
      tag: el.tagName,
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      value: el.type === 'hidden' ? '[hidden]' : (el.value || ''),
      checked: !!el.checked,
      placeholder: el.placeholder || '',
      aria: el.getAttribute('aria-label') || '',
      label: el.closest('label')?.innerText || document.querySelector('label[for="'+el.id+'"]')?.innerText || ''
    })),
    buttons: [...document.querySelectorAll('button,input[type=submit],a,[role=button]')].map((el, i) => ({
      i, text:(el.innerText || el.value || el.textContent || '').trim(), type:el.type || '', disabled:!!el.disabled
    })).filter(x => x.text)
  }))()`),
  githubSearchRepo: async (send) => {
    const query = process.argv[3] || 'entradasjujuy';
    await evaluate(send, `(() => {
      const input = [...document.querySelectorAll('input')].find(el => /Search for a repository/i.test(el.placeholder || el.getAttribute('aria-label') || ''));
      if (!input) return false;
      input.scrollIntoView({ block:'center' });
      input.focus();
      input.select && input.select();
      return true;
    })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', windowsVirtualKeyCode: 17 });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', windowsVirtualKeyCode: 17 });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.insertText', { text: query });
    await new Promise(r => setTimeout(r, 1200));
    return evaluate(send, `(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 5000),
      buttons: [...document.querySelectorAll('button,input[type=submit],a,[role=button]')].map((el, i) => ({
        i, text:(el.innerText || el.value || el.textContent || '').trim(), type:el.type || '', disabled:!!el.disabled
      })).filter(x => x.text)
    }))()`);
  },
  githubChooseRepo: (send) => evaluate(send, `(() => {
    const name = ${JSON.stringify(process.argv[3] || 'entradasjujuy')}.toLowerCase();
    const els = [...document.querySelectorAll('label,button,a,[role=option],[role=menuitem],li,div')];
    const el = els.find(e => (e.innerText || e.textContent || '').toLowerCase().includes(name));
    if (!el) return { ok:false, text:document.body.innerText.slice(0, 5000) };
    el.scrollIntoView({ block:'center' });
    el.click();
    return { ok:true, clicked:(el.innerText || el.textContent || '').trim().slice(0, 200), text:document.body.innerText.slice(0, 4000) };
  })()`),
  githubClickInstall: (send) => evaluate(send, `(() => {
    const btn = [...document.querySelectorAll('button,input[type=submit]')].find(el => /Install/i.test(el.innerText || el.value || el.textContent || ''));
    if (!btn) return { ok:false, text:document.body.innerText.slice(0, 3000) };
    if (btn.disabled) return { ok:false, disabled:true, text:document.body.innerText.slice(0, 3000) };
    btn.scrollIntoView({ block:'center' });
    btn.click();
    return { ok:true };
  })()`),
  typePostgresFields: async (send) => {
    async function type(selector, value) {
      await evaluate(send, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        el.select && el.select();
        return true;
      })()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', windowsVirtualKeyCode: 17 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', windowsVirtualKeyCode: 17 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.insertText', { text: value });
      await evaluate(send, `document.activeElement && document.activeElement.dispatchEvent(new Event('change', { bubbles:true }))`);
    }
    await type('#name', 'entradasjujuy-db');
    await type('#databaseName', 'entradasjujuy');
    await type('#databaseUser', 'entradasjujuy_user');
    return evaluate(send, `([...document.querySelectorAll('input')].slice(0,3).map(i => i.value))`);
  },
  fillWebServiceBasic: async (send) => {
    async function type(selector, value) {
      await evaluate(send, `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        el.select && el.select();
        return true;
      })()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', windowsVirtualKeyCode: 17 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', windowsVirtualKeyCode: 17 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.insertText', { text: value });
      await evaluate(send, `document.activeElement && document.activeElement.dispatchEvent(new Event('change', { bubbles:true }))`);
    }
    await type('#serviceName', 'entradasjujuy-backend');
    await type('#rootDir', 'backend');
    await type('#buildCommand', 'npm install');
    await type('#startCommand', 'npm run start:render');
    await evaluate(send, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /^Free\\b/i.test((b.innerText || '').trim()));
      if (btn) btn.click();
    })()`);
    return evaluate(send, `(() => ({
      name: document.querySelector('#serviceName')?.value,
      rootDir: document.querySelector('#rootDir')?.value,
      build: document.querySelector('#buildCommand')?.value,
      start: document.querySelector('#startCommand')?.value,
      text: document.body.innerText.slice(0, 4000)
    }))()`);
  },
  dbInspectSecretControls: (send) => evaluate(send, `(() => {
    const ids = ['database-password','internal-database-url','external-database-url','psql-command'];
    return ids.map(id => {
      const el = document.getElementById(id);
      const wrap = el?.closest('div');
      const buttons = [...(wrap?.querySelectorAll('button,a,[role=button]') || [])].map((b, i) => ({
        i,
        text:(b.innerText || b.textContent || '').trim(),
        aria:b.getAttribute('aria-label') || '',
        title:b.getAttribute('title') || '',
        type:b.getAttribute('type') || ''
      }));
      let html = wrap?.outerHTML || '';
      html = html.replace(/value="[^"]*"/g, 'value="[masked]"').slice(0, 1200);
      return { id, type:el?.type, valueLength:el?.value?.length || 0, buttons, html };
    });
  })()`),
  deployRenderBackend: async (send) => {
    if (!/\/d\//.test(await evaluate(send, `location.pathname`))) {
      await send('Page.navigate', { url: 'https://dashboard.render.com/d/dpg-d81l80reo5us73ch2hu0-a' });
      await waitFor(send, `!!document.querySelector('#internal-database-url')`, 30000);
    }

    await evaluate(send, `(() => {
      const input = document.querySelector('#internal-database-url');
      const copy = [...(input?.closest('div')?.querySelectorAll('button') || [])].find(b => b.getAttribute('aria-label') === 'Copy');
      if (copy) copy.click();
      return !!copy;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    const databaseUrl = await evaluate(send, `navigator.clipboard.readText().catch(() => '')`);
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('No pude leer la Internal Database URL de Render.');

    const envPath = path.join(process.cwd(), 'backend', '.env');
    const localEnv = parseEnvFile(envPath);
    const backendUrl = 'https://entradasjujuy-backend.onrender.com';
    const frontendUrl = 'https://entradasjujuy.vercel.app';
    const vars = {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: localEnv.JWT_SECRET || crypto.randomBytes(48).toString('hex'),
      MP_ACCESS_TOKEN: localEnv.MP_ACCESS_TOKEN || '',
      MP_PUBLIC_KEY: localEnv.MP_PUBLIC_KEY || '',
      MP_CLIENT_ID: localEnv.MP_CLIENT_ID || '',
      MP_CLIENT_SECRET: localEnv.MP_CLIENT_SECRET || '',
      GOOGLE_CLIENT_ID: localEnv.GOOGLE_CLIENT_ID || '258196394841-1fgpfbm966tvlo87d8ilji09fmnjlejq.apps.googleusercontent.com',
      BACKEND_URL: backendUrl,
      FRONTEND_URL: frontendUrl,
      CORS_ORIGIN: frontendUrl,
      SMTP_HOST: localEnv.SMTP_HOST || '',
      SMTP_PORT: localEnv.SMTP_PORT || '',
      SMTP_USER: localEnv.SMTP_USER || '',
      SMTP_PASS: localEnv.SMTP_PASS || '',
    };
    const missing = Object.entries(vars).filter(([k, v]) => !v && !['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MP_PUBLIC_KEY','MP_CLIENT_ID','MP_CLIENT_SECRET'].includes(k)).map(([k]) => k);
    if (missing.length) throw new Error(`Faltan variables requeridas: ${missing.join(', ')}`);

    await send('Page.navigate', { url: 'https://dashboard.render.com/web/new' });
    await waitFor(send, `document.body.innerText.includes('New Web Service')`, 30000);
    const onRepoList = await evaluate(send, `document.body.innerText.includes('Credentials') && document.body.innerText.includes('Antonioberno99')`);
    if (onRepoList) {
      await evaluate(send, `(() => {
        const el = [...document.querySelectorAll('button,a,[role=button]')].find(e => (e.innerText || e.textContent || '').includes('Antonioberno99') && (e.innerText || e.textContent || '').includes('entradasjujuy'));
        if (!el) return false;
        el.click();
        return true;
      })()`);
    }
    await waitFor(send, `!!document.querySelector('#serviceName')`, 30000);

    await typeInto(send, '#serviceName', 'entradasjujuy-backend');
    await typeInto(send, '#rootDir', 'backend');
    await typeInto(send, '#buildCommand', 'npm install');
    await typeInto(send, '#startCommand', 'npm run start:render');
    await evaluate(send, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /^Free\\b/i.test((b.innerText || '').trim()));
      if (btn) btn.click();
      return true;
    })()`);

    const entries = Object.entries(vars).filter(([, v]) => v !== '');
    for (let i = 0; i < entries.length - 1; i += 1) {
      await evaluate(send, `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /Add Environment Variable/i.test(b.innerText || b.textContent || ''));
        if (btn) btn.click();
        return !!btn;
      })()`);
      await new Promise((r) => setTimeout(r, 120));
    }

    await evaluate(send, `((entries) => {
      const set = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        el.focus();
        setter.call(el, value);
        el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:value }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
        el.blur();
      };
      const keys = [...document.querySelectorAll('input[placeholder="NAME_OF_VARIABLE"]')];
      const values = [...document.querySelectorAll('textarea[placeholder="value"]')];
      entries.forEach(([key, value], i) => {
        if (!keys[i] || !values[i]) throw new Error('No hay suficientes filas de variables.');
        set(keys[i], key);
        set(values[i], value);
      });
      return true;
    })(${JSON.stringify(entries)})`);

    await new Promise((r) => setTimeout(r, 500));
    const beforeDeploy = await evaluate(send, `(() => ({
      keys: [...document.querySelectorAll('input[placeholder="NAME_OF_VARIABLE"]')].map(i => i.value).filter(Boolean),
      disabled: [...document.querySelectorAll('button')].find(b => /Deploy Web Service/i.test(b.innerText || b.textContent || ''))?.disabled || false
    }))()`);
    if (beforeDeploy.disabled) throw new Error('El botón Deploy Web Service está deshabilitado.');

    await evaluate(send, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /Deploy Web Service/i.test(b.innerText || b.textContent || ''));
      if (!btn || btn.disabled) return false;
      btn.scrollIntoView({ block:'center' });
      btn.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 3000));
    return {
      ok: true,
      backendUrl,
      frontendUrl,
      envKeys: beforeDeploy.keys,
      currentUrl: await evaluate(send, `location.href`)
    };
  },
  prepareRenderBackendSkeleton: async (send) => {
    const hasForm = await evaluate(send, `!!document.querySelector('#serviceName')`).catch(() => false);
    if (!hasForm) {
      await send('Page.navigate', { url: 'https://dashboard.render.com/web/new' });
      await waitFor(send, `document.body.innerText.includes('New Web Service')`, 30000);
    }
    const onRepoList = await evaluate(send, `document.body.innerText.includes('Credentials') && document.body.innerText.includes('Antonioberno99')`);
    if (onRepoList) {
      await evaluate(send, `(() => {
        const el = [...document.querySelectorAll('button,a,[role=button]')].find(e => (e.innerText || e.textContent || '').includes('Antonioberno99') && (e.innerText || e.textContent || '').includes('entradasjujuy'));
        if (!el) return false;
        el.click();
        return true;
      })()`);
    }
    await waitFor(send, `!!document.querySelector('#serviceName')`, 30000);

    await typeInto(send, '#serviceName', 'entradasjujuy-backend');
    await typeInto(send, '#rootDir', 'backend');
    await typeInto(send, '#buildCommand', 'npm install');
    await typeInto(send, '#startCommand', 'npm run start:render');
    await evaluate(send, `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /^Free\\b/i.test((b.innerText || '').trim()));
      if (btn) btn.click();
      return true;
    })()`);

    const entries = [
      ['NODE_ENV', 'production'],
      ['DATABASE_URL', 'PEGAR_INTERNAL_DATABASE_URL_DE_RENDER'],
      ['JWT_SECRET', 'PEGAR_O_GENERAR_SECRETO_LARGO'],
      ['MP_ACCESS_TOKEN', 'PEGAR_ACCESS_TOKEN_DE_MERCADO_PAGO'],
      ['MP_PUBLIC_KEY', 'PEGAR_PUBLIC_KEY_DE_MERCADO_PAGO'],
      ['MP_CLIENT_ID', 'PEGAR_CLIENT_ID_DE_MERCADO_PAGO'],
      ['MP_CLIENT_SECRET', 'PEGAR_CLIENT_SECRET_DE_MERCADO_PAGO'],
      ['GOOGLE_CLIENT_ID', '258196394841-1fgpfbm966tvlo87d8ilji09fmnjlejq.apps.googleusercontent.com'],
      ['BACKEND_URL', 'https://entradasjujuy-backend.onrender.com'],
      ['FRONTEND_URL', 'https://entradasjujuy.vercel.app'],
      ['CORS_ORIGIN', 'https://entradasjujuy.vercel.app'],
      ['SMTP_HOST', 'PEGAR_SMTP_HOST'],
      ['SMTP_PORT', 'PEGAR_SMTP_PORT'],
      ['SMTP_USER', 'PEGAR_SMTP_USER'],
      ['SMTP_PASS', 'PEGAR_SMTP_PASS'],
    ];

    const existingRows = await evaluate(send, `document.querySelectorAll('input[placeholder="NAME_OF_VARIABLE"]').length`);
    for (let i = existingRows; i < entries.length; i += 1) {
      await evaluate(send, `(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /Add Environment Variable/i.test(b.innerText || b.textContent || ''));
        if (btn) btn.click();
        return !!btn;
      })()`);
      await new Promise((r) => setTimeout(r, 120));
    }

    await evaluate(send, `((entries) => {
      const set = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        el.focus();
        setter.call(el, value);
        el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:value }));
        el.dispatchEvent(new Event('change', { bubbles:true }));
        el.blur();
      };
      const keys = [...document.querySelectorAll('input[placeholder="NAME_OF_VARIABLE"]')];
      const values = [...document.querySelectorAll('textarea[placeholder="value"]')];
      entries.forEach(([key, value], i) => {
        set(keys[i], key);
        set(values[i], value);
      });
      return true;
    })(${JSON.stringify(entries)})`);

    return evaluate(send, `(() => ({
      ok:true,
      url: location.href,
      keys: [...document.querySelectorAll('input[placeholder="NAME_OF_VARIABLE"]')].map(i => i.value).filter(Boolean)
    }))()`);
  },
};

withCdp(async (send) => {
  const fn = actions[action];
  if (!fn) throw new Error(`Unknown action ${action}`);
  const result = await fn(send);
  console.log(JSON.stringify(result, null, 2));
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
