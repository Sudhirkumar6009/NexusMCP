if (typeof fetch !== "function") {
  throw new Error("Global fetch is not available in this Node runtime");
}

function normalizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

function joinWebhookUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}/${String(path || "").replace(/^\/+/, "")}`;
}

const LOCAL_URL = normalizeBaseUrl(
  process.env.APP_BASE_URL || "http://localhost:5000",
);

async function testEndpoint(name, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    console.log(`\n=== ${name} ===`);
    console.log("URL:", url);
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch (err) {
    console.log(`\n=== ${name} ERROR ===`);
    console.log(err.message);
  }
}

(async () => {
  // 1) GitHub payload with sender + pusher
  await testEndpoint(
    "GITHUB REAL PAYLOAD",
    joinWebhookUrl(LOCAL_URL, "/api/webhook/github"),
    {
      ref: "refs/heads/main",
      repository: { name: "test-repo" },
      sender: { login: "sudhir" },
      pusher: { name: "sudhir" },
    },
    {
      "X-GitHub-Event": "push",
      "X-GitHub-Delivery": "test-js-gh-1",
    },
  );

  // 2) Slack payload with user + channel
  await testEndpoint(
    "SLACK EVENT TEST",
    joinWebhookUrl(LOCAL_URL, "/api/webhook/slack"),
    {
      event: {
        type: "message",
        text: "trigger workflow",
        user: "U123",
        channel: "C456",
        ts: "123456",
      },
    },
  );

  // 3) Slack challenge verification
  await testEndpoint(
    "SLACK VERIFICATION TEST",
    joinWebhookUrl(LOCAL_URL, "/api/webhook/slack"),
    {
      challenge: "verify123",
    },
  );
})();
