const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function methodNotAllowed() {
  return json({ error: 'method not allowed' }, 405);
}

export function badRequest(message) {
  return json({ error: message }, 400);
}
