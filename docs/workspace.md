---
id: workspace
title: workspace
aliases:
  - workspace
  - workspace.md
tags: []
layer: core
summary: "Workspace Architecture\r\n\r\nCurrent:\r\n\r\n/workspace/users/{userId}/sessions/{conversationId}\r\n\r\nImprove with workspace lifecycle manager.\r\n\r\nworkspace-manager\r\n\r\nHandles:\r\n\r\ncreate workspace\r\nsnapshot workspace\r\ncleanup old sessions\r\ngit commit checkpoints\r\n\r\nAdd automatic Git layer.\r\n\r\nExample:\r\n\r\nwor"
anchors: []
---
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
