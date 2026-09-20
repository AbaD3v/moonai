import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, executeTool, openAITransport, groqTransport } from './agent.mjs';
import { createAgentServer, providerConfig } from './index.mjs';

test('provider config selects separate keys and rejects unknown providers', () => {
  assert.deepEqual(providerConfig({}), { provider: 'groq', apiKey: '', model: 'openai/gpt-oss-20b' });
  assert.equal(providerConfig({ OPENAI_API_KEY: 'other-provider' }).apiKey, '');
  assert.equal(providerConfig({ AGENT_PROVIDER: 'openai', GROQ_API_KEY: 'other-provider' }).apiKey, '');
  assert.equal(providerConfig({ GROQ_API_KEY: 'groq-test' }).apiKey, 'groq-test');
  assert.throws(() => providerConfig({ AGENT_PROVIDER: 'invalid' }));
});

test('Groq receives supported parameters and our real tool result on continuation', async () => {
  let requests = 0;
  const transport = groqTransport('groq-test-key', async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer groq-test-key');
    const body = JSON.parse(options.body);
    assert.equal('include' in body, false);
    assert.equal('store' in body, false);
    assert.equal(body.tools[0].name, 'calculate');
    if (requests++ === 0) return Response.json({ status: 'completed', output: [call()] });
    assert.equal(JSON.parse(body.input.at(-1).output).result, 3600);
    assert.equal(body.input.at(-1).call_id, 'c1');
    return Response.json(final);
  });
  await run({ createResponse: transport });
  assert.equal(requests, 2);
});

const final = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Итого 3960 ₸.' }] }] };
const call = (args = { operation: 'multiply', a: 1200, b: 3 }, name = 'calculate') => ({ type: 'function_call', name, call_id: 'c1', arguments: JSON.stringify(args) });
const run = options => runAgent({ goal: 'Билеты со сбором', model: 'test-model', signal: new AbortController().signal, emit: () => {}, ...options });

test('repeated operation reuses result and allows the next operation', async () => {
  let count = 0;
  const events = [];
  await run({ emit: e => events.push(e), createResponse: async body => {
    count++;
    if (count === 1) return { status: 'completed', output: [call({ operation: 'subtract', a: 6, b: 2 })] };
    assert.match(body.instructions, /"result":4/);
    if (count === 2) return { status: 'completed', output: [call({ b: 2, a: 6, operation: 'subtract' })] };
    if (count === 3) {
      assert.deepEqual(JSON.parse(body.input.at(-1).output), { result: 4, cached: true });
      return { status: 'completed', output: [call({ operation: 'add', a: 4, b: 1 })] };
    }
    assert.equal(JSON.parse(body.input.at(-1).output).result, 5);
    return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '5 яблок' }] }] };
  } });
  assert.equal(events.at(-1).text, '5 яблок');
});

test('persistent repetition stops early without presenting a partial result as final', async () => {
  const events = [];
  let count = 0;
  await assert.rejects(run({ emit: e => events.push(e), createResponse: async () => {
    count++;
    return { status: 'completed', output: [call()] };
  } }), /без прогресса/);
  assert.equal(count, 3);
  assert.equal(events.some(e => e.type === 'final'), false);
});

test('tool results and all model state return to Responses; real calculation reaches final', async () => {
  let requests = 0;
  const events = [];
  await run({ emit: event => events.push(event), createResponse: async body => {
    assert.equal(body.store, false);
    assert.equal(body.tools[0].strict, true);
    if (requests++ === 0) return { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'state' }, call()] };
    assert.ok(body.input.some(item => item.encrypted_content === 'state'));
    assert.equal(JSON.parse(body.input.at(-1).output).result, 3600);
    assert.equal(body.input.at(-1).call_id, 'c1');
    return final;
  } });
  assert.equal(requests, 2);
  assert.deepEqual(events.map(e => e.type), ['model', 'tool_call', 'tool_result', 'model', 'final']);
});

test('invalid tools and arguments cannot execute; model can correct an error', async () => {
  assert.throws(() => executeTool('shell', {}));
  assert.throws(() => executeTool('calculate', { operation: 'divide', a: 2, b: 0 }));
  assert.throws(() => executeTool('calculate', { operation: 'add', a: '2', b: 1 }));
  assert.throws(() => executeTool('calculate', { operation: 'add', a: 2, b: 1, code: 'x' }));
  let count = 0;
  await run({ createResponse: async body => {
    if (count++ === 0) return { status: 'completed', output: [{ ...call(), arguments: '{broken' }] };
    assert.ok(JSON.parse(body.input.at(-1).output).error);
    return final;
  } });
});

test('bounded loops, cancellation, incomplete and empty answers are not success', async () => {
  let count = 0;
  await assert.rejects(run({ createResponse: async () => { count++; return { status: 'completed', output: [call({ operation: 'add', a: count, b: 1 })] }; } }), /5 обращений/);
  assert.equal(count, 5);
  await assert.rejects(run({ createResponse: async () => ({ status: 'incomplete', output: [] }) }), /не завершила/);
  await assert.rejects(run({ createResponse: async () => ({ status: 'completed', output: [] }) }), /пустой/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run({ signal: controller.signal, createResponse: () => assert.fail('Called after cancel') }));
});

test('transport uses official endpoint; provider errors do not disclose payload', async () => {
  const transport = openAITransport('test-secret', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return new Response(JSON.stringify({ error: 'test-secret' }), { status: 401 });
  });
  await assert.rejects(transport({}, new AbortController().signal), error => error.message.includes('401') && !error.message.includes('test-secret'));
});

test('HTTP: missing config, origin validation, streaming and input validation', async () => {
  for (const configured of [false, true]) {
    const server = createAgentServer(configured ? { apiKey: 'test', model: 'test-model', transport: async () => final } : {});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const headers = { Host: '127.0.0.1:3001', 'Content-Type': 'application/json' };
    try {
      const status = await fetch(`${url}/api/agent/status`, { headers }).then(r => r.json());
      assert.equal(status.configured, configured);
      assert.equal(JSON.stringify(status).includes('apiKey'), false);
      const rejected = await fetch(`${url}/api/agent/run`, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: '{}' });
      assert.equal(rejected.status, 403);
      const response = await fetch(`${url}/api/agent/run`, { method: 'POST', headers, body: JSON.stringify({ goal: 'Привет' }) });
      assert.equal(response.status, configured ? 200 : 503);
      if (configured) {
        const events = (await response.text()).trim().split('\n').map(JSON.parse);
        assert.equal(events.at(-1).type, 'final');
        const invalid = await fetch(`${url}/api/agent/run`, { method: 'POST', headers, body: '{' });
        assert.equal(invalid.status, 400);
      }
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
