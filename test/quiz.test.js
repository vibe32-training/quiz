import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, validateQuiz } from "../lib/quiz.js";
import { generateQuiz, QuizError } from "../lib/generate.js";

const base = { subject: "과학", unit: "태양계", type: "multiple" };

test("validateRequest accepts boundary counts and rejects out-of-range or non-integer counts", () => {
  assert.equal(validateRequest({ ...base, count: 1 }).value.count, 1);
  assert.equal(validateRequest({ ...base, count: 25 }).value.count, 25);
  for (const count of [0, 26, 2.5, "5", null]) {
    assert.ok(validateRequest({ ...base, count }).error, `count ${count} should be rejected`);
  }
});

test("validateRequest rejects blank subject/unit and unknown types", () => {
  assert.ok(validateRequest({ ...base, subject: "   ", count: 5 }).error);
  assert.ok(validateRequest({ ...base, unit: "", count: 5 }).error);
  assert.ok(validateRequest({ ...base, type: "essay", count: 5 }).error);
  assert.ok(validateRequest({ ...base, type: "toString", count: 5 }).error);
});

const mc = (overrides = {}) => ({
  question: "Q", choices: ["a", "b", "c", "d"], answer: 2, explanation: "E", ...overrides
});

test("validateQuiz enforces count and multiple-choice structure", () => {
  assert.equal(validateQuiz({ questions: [mc(), mc()] }, "multiple", 2).length, 2);
  assert.throws(() => validateQuiz({ questions: [mc()] }, "multiple", 2), /문항 수/);
  assert.throws(() => validateQuiz({ questions: [mc({ choices: ["a", "b", "c"] })] }, "multiple", 1));
  assert.throws(() => validateQuiz({ questions: [mc({ choices: ["a", "a", "c", "d"] })] }, "multiple", 1), /중복/);
  assert.throws(() => validateQuiz({ questions: [mc({ answer: 5 })] }, "multiple", 1), /정답 번호/);
});

test("validateQuiz requires a model answer for short-answer questions", () => {
  const ok = validateQuiz({ questions: [{ question: "Q", answer: "A", explanation: "E" }] }, "short", 1);
  assert.deepEqual(ok, [{ question: "Q", answer: "A", explanation: "E" }]);
  assert.throws(() => validateQuiz({ questions: [{ question: "Q", answer: " ", explanation: "E" }] }, "short", 1));
});

const env = { AI_ENDPOINT: "https://example.test/openai/v1/", AI_API_KEY: "test-key", AI_DEPLOYMENT: "m" };
const reply = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] })
});

test("generateQuiz retries once when the model returns an invalid quiz", async () => {
  const calls = [];
  const responses = [reply({ questions: [] }), reply({ questions: [mc()] })];
  const fakeFetch = async (url, init) => { calls.push({ url, init }); return responses.shift(); };
  const result = await generateQuiz({ ...base, count: 1 }, env, fakeFetch);
  assert.equal(result.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://example.test/openai/v1/chat/completions");
});

test("generateQuiz maps auth failures to a QuizError without exposing the key", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(generateQuiz({ ...base, count: 1 }, env, fakeFetch), (error) => {
      assert.ok(error instanceof QuizError);
      assert.ok(!error.message.includes(env.AI_API_KEY));
      return true;
    });
  } finally {
    console.error = originalError;
  }
});
