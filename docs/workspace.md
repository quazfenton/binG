Workspace Architecture

Current:

/workspace/users/{userId}/sessions/{conversationId}

Improve with workspace lifecycle manager.

workspace-manager

Handles:

create workspace
snapshot workspace
cleanup old sessions
git commit checkpoints

Add automatic Git layer.

Example:

workspace/.git

Benefits:

diff tracking

rollback

patch streaming


File Change Tracking Improvement

Current tracking:

fileChanges.push({
  path,
  operation: "write",
  content
})

Better:

git diff based tracking

Instead of sending full file content.

Send:

patch diff

Example:

@@ -1,5 +1,5 @@
-import auth
+import authProvider

Much faster for UI.