import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGradeRequest, validateRequest, validateQuiz } from "../lib/quiz.js";
import { generateQuiz, gradeAnswers, QuizError } from "../lib/generate.js";

const base = { subject: "과학", unit: "태양계", type: "multiple" };

test("validateRequest accepts boundary counts and rejects out-of-range or non-integer counts", () => {
  assert.equal(validateRequest({ ...base, count: 1 }).value.count, 1);
  assert.equal(validateRequest({ ...base, count: 25 }).value.count, 25);
  for (const count of [0, 26, 2.5, "5", null]) {
    assert.ok(validateRequest({ ...base, count }).error, `count ${count} should be rejected`);
  }
});

test("validateRequest rejects blank subject/unit and unknown types or modes", () => {
  assert.ok(validateRequest({ ...base, subject: "   ", count: 5 }).error);
  assert.ok(validateRequest({ ...base, unit: "", count: 5 }).error);
  assert.ok(validateRequest({ ...base, type: "essay", count: 5 }).error);
  assert.ok(validateRequest({ ...base, type: "toString", count: 5 }).error);
  assert.ok(validateRequest({ ...base, mode: "url", count: 5 }).error);
  assert.equal(validateRequest({ ...base, type: "mixed", count: 5 }).value.mode, "topic");
});

test("validateRequest requires PDF source text within length limits", () => {
  const pdf = { ...base, mode: "pdf", count: 5 };
  assert.ok(validateRequest(pdf).error);
  assert.ok(validateRequest({ ...pdf, sourceText: "가".repeat(99) }).error);
  assert.ok(validateRequest({ ...pdf, sourceText: "가".repeat(40_001) }).error);
  assert.equal(validateRequest({ ...pdf, sourceText: "가".repeat(100) }).value.sourceText.length, 100);
  assert.equal(validateRequest({ ...base, count: 5, sourceText: "ignored" }).value.sourceText, undefined);
});

const mc = (overrides = {}) => ({
  question: "Q", choices: ["a", "b", "c", "d"], answer: 2, explanation: "E", ...overrides
});

test("validateQuiz enforces count and multiple-choice structure", () => {
  const items = validateQuiz({ questions: [mc(), mc()] }, "multiple", 2);
  assert.equal(items[0].kind, "multiple");
  assert.throws(() => validateQuiz({ questions: [mc()] }, "multiple", 2), /문항 수/);
  assert.throws(() => validateQuiz({ questions: [mc({ choices: ["a", "b", "c"] })] }, "multiple", 1));
  assert.throws(() => validateQuiz({ questions: [mc({ choices: ["a", "a", "c", "d"] })] }, "multiple", 1), /중복/);
  assert.throws(() => validateQuiz({ questions: [mc({ answer: 5 })] }, "multiple", 1), /정답 번호/);
});

test("validateQuiz requires a model answer for short-answer questions", () => {
  const ok = validateQuiz({ questions: [{ question: "Q", answer: "A", explanation: "E" }] }, "short", 1);
  assert.deepEqual(ok, [{ kind: "short", question: "Q", answer: "A", explanation: "E" }]);
  assert.throws(() => validateQuiz({ questions: [{ question: "Q", answer: " ", explanation: "E" }] }, "short", 1));
});

const mixedItem = (kind, answer, choices = []) => ({ kind, question: "Q", choices, answer, explanation: "E" });

test("validateQuiz normalizes mixed questions and requires all three kinds", () => {
  const items = validateQuiz({
    questions: [mixedItem("multiple", "3", ["a", "b", "c", "d"]), mixedItem("short", "답"), mixedItem("ox", " x ")]
  }, "mixed", 3);
  assert.equal(items[0].answer, 3);
  assert.equal(items[1].answer, "답");
  assert.equal(items[2].answer, "X");
  assert.equal(items[2].choices, undefined);

  assert.throws(() => validateQuiz({ questions: [mixedItem("ox", "O"), mixedItem("ox", "X"), mixedItem("short", "답")] }, "mixed", 3), /모두/);
  assert.throws(() => validateQuiz({ questions: [mixedItem("ox", "참")] }, "mixed", 1), /O 또는 X/);
  assert.throws(() => validateQuiz({ questions: [mixedItem("essay", "답")] }, "mixed", 1), /유형/);
  assert.equal(validateQuiz({ questions: [mixedItem("ox", "O"), mixedItem("ox", "X")] }, "mixed", 2).length, 2);
});

test("validateGradeRequest checks item count, required fields and answer length", () => {
  const item = { question: "Q", answer: "A", explanation: "E", response: "R" };
  assert.equal(validateGradeRequest({ items: [item] }).value.length, 1);
  assert.ok(validateGradeRequest({ items: [] }).error);
  assert.ok(validateGradeRequest({ items: Array(26).fill(item) }).error);
  assert.ok(validateGradeRequest({ items: [{ ...item, response: "  " }] }).error);
  assert.ok(validateGradeRequest({ items: [{ ...item, response: "가".repeat(501) }] }).error);
  assert.ok(validateGradeRequest({ items: [{ ...item, answer: "" }] }).error);
});

const env = { AI_ENDPOINT: "https://example.test/openai/v1/", AI_API_KEY: "test-key", AI_DEPLOYMENT: "m" };
const reply = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] })
});
const quiet = async (fn) => {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { warn, error }); }
};

test("generateQuiz retries once when the model returns an invalid quiz", async () => {
  const calls = [];
  const responses = [reply({ questions: [] }), reply({ questions: [mc()] })];
  const fakeFetch = async (url, init) => { calls.push({ url, init }); return responses.shift(); };
  const result = await quiet(() => generateQuiz({ ...base, mode: "topic", count: 1 }, env, fakeFetch));
  assert.equal(result.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://example.test/openai/v1/chat/completions");
});

test("generateQuiz sends PDF source text to the model only in pdf mode", async () => {
  let sent;
  const fakeFetch = async (url, init) => { sent = JSON.parse(init.body); return reply({ questions: [mc()] }); };
  await generateQuiz({ ...base, mode: "pdf", count: 1, sourceText: "광합성 자료" }, env, fakeFetch);
  assert.equal(JSON.parse(sent.messages[1].content).source, "광합성 자료");
  await generateQuiz({ ...base, mode: "topic", count: 1 }, env, fakeFetch);
  assert.equal(JSON.parse(sent.messages[1].content).source, undefined);
});

test("generateQuiz maps auth failures to a QuizError without exposing the key", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  await quiet(() => assert.rejects(generateQuiz({ ...base, mode: "topic", count: 1 }, env, fakeFetch), (error) => {
    assert.ok(error instanceof QuizError);
    assert.ok(!error.message.includes(env.AI_API_KEY));
    return true;
  }));
});

test("gradeAnswers rejects results whose count does not match the items", async () => {
  const items = [{ question: "Q", answer: "A", explanation: "E", response: "R" }];
  const ok = await gradeAnswers(items, env, async () => reply({ results: [{ correct: true, feedback: "좋아요" }] }));
  assert.deepEqual(ok, [{ correct: true, feedback: "좋아요" }]);
  await quiet(() => assert.rejects(gradeAnswers(items, env, async () => reply({ results: [] })), QuizError));
});
