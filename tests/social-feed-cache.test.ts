import assert from "node:assert/strict";
import test from "node:test";
import { cacheSocialPreference, cachedSocialFriends, cachedSocialHome, clearSocialPreference,
  fetchSocialFriends, fetchSocialHome, invalidateSocialHome, socialDeletionRetryState, updateCachedSocialHome } from "../lib/social/client";

test("Friends keeps confirmed content during refresh, deduplicates requests and isolates account switches", async () => {
  const values = new Map<string, string>();
  const priorStorage = globalThis.localStorage, priorFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  let owner = "account-a", homeRequests = 0, friendRequests = 0, failHome = false;
  let delayHome = false, homeStarted = false, releaseHome: (() => void) | undefined;
  globalThis.fetch = (async (url: string) => {
    await new Promise((resolve) => setTimeout(resolve, 8));
    if (url.endsWith("/me")) return new Response(JSON.stringify({ email: `${owner}@example.invalid`,
      accountId: owner, displayName: owner, sharingEnabled: true }), { status: 200 });
    if (url.endsWith("/home")) { homeRequests++;
      if (delayHome) { homeStarted = true; await new Promise<void>((resolve) => { releaseHome = resolve; }); }
      if (failHome) throw new Error("offline");
      return new Response(JSON.stringify({ friendCount: 1, activities: [{ id: `activity-${owner}` }], received: [] }), { status: 200 }); }
    if (url.endsWith("/friends")) { friendRequests++;
      return new Response(JSON.stringify({ friends: [{ id: `friend-${owner}`, displayName: owner,
        email: `${owner}@example.invalid`, status: "accepted", direction: "incoming" }] }), { status: 200 }); }
    throw new Error("unexpected request");
  }) as typeof fetch;
  try {
    clearSocialPreference();
    const [first, second] = await Promise.all([fetchSocialHome(true), fetchSocialHome(true)]);
    assert.equal(first.home.activities[0].id, "activity-account-a");
    assert.equal(second.home.activities[0].id, "activity-account-a");
    assert.equal(homeRequests, 1);
    assert.equal(cachedSocialHome()?.me.accountId, "account-a");
    await fetchSocialHome();
    assert.equal(homeRequests, 1, "fresh navigation uses the bounded cache");
    await Promise.all([fetchSocialFriends(true), fetchSocialFriends(true)]);
    assert.equal(friendRequests, 1);
    assert.equal(cachedSocialFriends()?.[0].id, "friend-account-a");
    failHome = true;
    await assert.rejects(fetchSocialHome(true));
    assert.equal(cachedSocialHome()?.home.activities[0].id, "activity-account-a", "transient failure preserves visible content");
    failHome = false;
    updateCachedSocialHome((home) => ({ ...home, friendCount: 2 }));
    assert.equal(cachedSocialHome()?.home.friendCount, 2);
    invalidateSocialHome();
    await fetchSocialHome();
    assert.equal(homeRequests, 3, "invalidated content revalidates");
    delayHome = true;
    const stale = fetchSocialHome(true);
    const rejected = assert.rejects(stale);
    while (!homeStarted) await new Promise((resolve) => setTimeout(resolve, 1));
    updateCachedSocialHome((home) => ({ ...home, activities: home.activities.map((item) =>
      item.id === "activity-account-a" ? { ...item, myReaction: "🔥", reactions: { "🔥": 1 } } : item) }));
    releaseHome!(); await rejected; delayHome = false;
    assert.equal(cachedSocialHome()?.home.activities[0].myReaction, "🔥", "an older response cannot overwrite the stable-ID reaction");
    values.set("treino-social-delete-outbox-v1", JSON.stringify([{ clientSessionId: "mine", ownerAccountId: "account-a", ready: true },
      { clientSessionId: "other", ownerAccountId: "account-b", ready: true }, { clientSessionId: "undo", ownerAccountId: "account-a", ready: false }]));
    const me = cachedSocialHome()!.me;
    values.set("treino-social-diagnostics-v1", JSON.stringify({ lastDeleteResult: "http_503" }));
    assert.deepEqual(socialDeletionRetryState(me), { pending: 1, result: "http_503", retryable: true });
    values.set("treino-social-diagnostics-v1", JSON.stringify({ lastDeleteResult: "http_401" }));
    assert.equal(socialDeletionRetryState(me).retryable, false, "authentication needs reconnect, not an ineffective Retry");
    owner = "account-b";
    cacheSocialPreference({ email: "account-b@example.invalid", accountId: "account-b",
      displayName: "B", sharingEnabled: true }, undefined, true);
    assert.equal(cachedSocialHome(), null, "B cannot see A's cached activities");
    assert.equal(cachedSocialFriends(), null, "B cannot see A's cached friend list");
    const next = await fetchSocialHome(true);
    assert.equal(next.home.activities[0].id, "activity-account-b");
    clearSocialPreference();
    assert.equal(cachedSocialHome(), null);
  } finally {
    clearSocialPreference();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: priorStorage });
    globalThis.fetch = priorFetch;
  }
});
