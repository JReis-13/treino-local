# Friends navigation and refresh

The five mobile tabs are Home, History, Friends, Stats and Settings. Plans stays at `/plans/`, linked from Home's current training card and Settings → Training plans. Home's compact Friends preview remains between current training and workout choice.

`/friends/` reuses the safe recent-activity component, accepted-friend directory, pending request count and sharing/notification preferences link. Friend links use the existing `/friends/[id]/` authorized, paginated summary history. Private workout History remains separate.

Previously each mounted activity component initialized with no data and independently fetched identity/feed, causing a loading flash on route return. A shared memory cache now retains the last confirmed identity/feed and friend directory. Freshness is 30 seconds for normal reads; navigation, foreground, reconnect and manual refresh revalidate. In-flight reads are shared. Existing content stays visible during refresh or transient failures; no polling loop is added. A full document reload intentionally rechecks identity instead of persisting social content to disk.

Cache ownership uses the verified account ID, with verified email fallback for older servers. Logout/account change clears both caches; late responses are guarded by identity revision. Feed/directory reads send the confirmed account ID and the server rejects mismatches. Publish, deletion, reaction and friendship actions update or invalidate cache. Friend removal drops cached social content immediately. Cached reaction changes match stable activity IDs.

Friends management contains the pending-removal recovery control, only for the current account's ready queue after a network, rate-limit or server failure. A server failure keeps the queue and says it is still pending. Automatic reconnect/foreground retries are unchanged. Diagnostics retains explicit upload consent, receipts and technical logs.

Synthetic browser tests cover 320/393/430/390 px, five large navigation targets, multiple activities, delayed return refresh, failure retention, request deduplication, browser Back/Forward, friend history, Plans access, account replacement and pending removals. Unit and database integration tests cover ownership, server mismatch rejection, authorization and exact reaction identity.
