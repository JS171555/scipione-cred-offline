// Mock de fetch para a suíte: NUNCA deixa uma chamada escapar para a rede.
//
// Motivo (auditoria 7-testes-infra.md §2.7, defeito D1): tests/apicpf.test.mjs atribuiu
// `process.env.APICPF_API_KEY = undefined`, que o Node coage para a string "undefined" (truthy); a guarda
// "sem chave" de api/cpf.js:20 foi burlada e uma requisição HTTPS REAL saiu para o upstream com um CPF na URL —
// e o assert de 503 passou pelo catch de api/cpf.js:43, não pela guarda. Este helper torna isso impossível:
// rota desconhecida = exceção local (denyNetwork é o default), nunca uma tentativa de conexão.
//
// Uso típico:
//   const net = installFetchMock({ routes: { 'https://upstream.invalid/api': { status: 200, json: { ok: true } } } });
//   ...chama o código do app...
//   assert.deepEqual(net.calls(), []);            // ou net.assertNoNetwork()
//   net.reset();
//
// Formas aceitas de rota (chave -> resposta):
//   chave:  string exata | prefixo com '*' (ex.: 'https://x.invalid/') | RegExp | função(url) -> booleano | '*'
//   valor:  Response | {status, json|text, headers} | Error (lança) | função(url, init) -> qualquer um destes
//           (a função pode ser async e pode devolver {response} para controle fino)
// Respostas sequenciais: passe um array — cada chamada consome o próximo item (o último se repete).

const state = {
  installed: false,
  real: globalThis.fetch,
  routes: [],
  fallback: 'deny',          // 'deny' | 'echo' | {…forma de rota}
  calls: [],
  denied: [],
};

const toResponse = (spec) => {
  if (spec instanceof Response) return spec;
  if (spec instanceof Error) throw spec;
  if (spec && typeof spec === 'object' && ('status' in spec || 'json' in spec || 'text' in spec || 'headers' in spec)) {
    const status = spec.status ?? 200;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...(spec.headers || {}) };
    const body = 'json' in spec ? JSON.stringify(spec.json) : (spec.text ?? '');
    return status === 204 ? new Response(null, { status, headers: spec.headers }) : new Response(body, { status, headers });
  }
  throw Object.assign(new Error('fetch-mock: formato de rota não reconhecido'), { code: 'BAD_ROUTE_SPEC' });
};

const matches = (key, url) =>
  typeof key === 'function' ? !!key(url)
    : key instanceof RegExp ? key.test(url)
      : key === '*' ? true
        : key.endsWith('*') ? url.startsWith(key.slice(0, -1))
          : url === key;

export function installFetchMock({ routes = {}, default: fallback = 'deny' } = {}) {
  state.routes = Object.entries(routes).map(([key, value]) => ({ key, value }));
  state.fallback = fallback;
  state.calls = [];
  state.denied = [];
  if (!state.installed) { state.real = globalThis.fetch; state.installed = true }
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    const record = { url, init, method: (init?.method ?? input?.method ?? 'GET').toUpperCase(), headers: init?.headers ?? {} };
    state.calls.push(record);
    for (const route of state.routes) {
      if (!matches(route.key, url)) continue;
      let value = route.value;
      if (Array.isArray(value)) value = value[Math.min(state.calls.filter((c) => c.url === url).length - 1, value.length - 1)];
      if (typeof value === 'function') value = await value(url, init);
      if (value && typeof value === 'object' && 'response' in value && !(value instanceof Response)) value = value.response;
      return toResponse(value);
    }
    if (state.fallback === 'deny') {
      state.denied.push(url);
      throw Object.assign(new Error(`fetch-mock: SEM ROTA para ${record.method} ${url} — este teste não faz rede (denyNetwork).`), { code: 'NETWORK_DENIED', url });
    }
    if (state.fallback === 'echo') return toResponse({ status: 200, json: { ok: true, echoed: url } });
    if (typeof state.fallback === 'function') return toResponse(await state.fallback(url, init));
    return toResponse(state.fallback);
  };
  return api;
}

// Rejeita explicitamente qualquer rota não cadastrada (é o default; mantido por clareza de intenção no teste).
// Não reinstala o mock e não limpa o log de chamadas — pode ser chamado no meio de um teste.
export function denyNetwork(message) {
  state.fallback = 'deny';
  if (message) state.denyMessage = message;
  return api;
}

export function uninstallFetchMock() {
  if (state.installed) globalThis.fetch = state.real;
  state.installed = false; state.routes = []; state.calls = []; state.denied = [];
}

export const fetchCalls = () => state.calls.map((c) => ({ url: c.url, init: c.init, method: c.method }));
export const fetchUrls = () => state.calls.map((c) => c.url);
export const deniedCalls = () => [...state.denied];
export function resetFetchMock() { state.calls = []; state.denied = []; return api }
export function assertNoNetwork(mensagem = 'nenhuma chamada de rede era permitida neste teste') {
  if (state.calls.length) {
    throw new assertNoNetwork.Failure(`${mensagem} — ${state.calls.length} chamada(s) registrada(s): ${state.calls.map((c) => c.url).join(', ')}`);
  }
  return true;
}
assertNoNetwork.Failure = class SemRede extends Error { }

const api = {
  install: installFetchMock,
  routes: (routes, fallback) => installFetchMock({ routes, default: fallback }),
  calls: fetchCalls,
  urls: fetchUrls,
  denied: deniedCalls,
  reset: resetFetchMock,
  deny: denyNetwork,
  assertNoNetwork,
  uninstall: uninstallFetchMock,
  // Última requisição registrada, útil em asserts de URL/headers.
  last: () => { const c = state.calls.at(-1); return c ? { url: c.url, init: c.init, method: c.method } : undefined },
  count: () => state.calls.length,
};
export default api;
