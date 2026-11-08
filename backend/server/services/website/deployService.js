// Website Management - the one place a Vercel Deploy Hook is ever triggered from (plan doc
// section 4.1). Deliberately a no-op, loud-but-non-blocking skip when the corresponding env var
// isn't configured - this lets Pages/Sections publish/preview actions work completely on their own
// data (snapshot a WebsiteRevision, flip status) WITHOUT ever touching Vercel/GitHub, exactly per
// this task's "do not attempt production deployment or modify Vercel/GitHub configuration without
// authorization" instruction. Once the two Deploy Hooks are created in the Vercel dashboard (see
// the final report's deployment instructions) and their URLs are set as
// WEBSITE_PUBLISH_DEPLOY_HOOK_URL / WEBSITE_PREVIEW_DEPLOY_HOOK_URL, publishing starts actually
// triggering a real rebuild - with no other code change needed anywhere else in this module.

async function triggerDeployHook(envVarName) {
  const url = process.env[envVarName];
  if (!url) {
    console.log(`[website:deploy] ${envVarName} is not configured - skipping the rebuild trigger (content is saved; nothing was deployed).`);
    return { triggered: false, reason: 'not_configured' };
  }
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) {
      console.error(`[website:deploy] Deploy hook ${envVarName} responded with HTTP ${res.status}.`);
      return { triggered: false, reason: `http_${res.status}` };
    }
    return { triggered: true };
  } catch (err) {
    // Best-effort - a Deploy Hook failing to fire must never roll back or block the real content
    // mutation (the publish/preview action) it was triggered by; the content is safely saved
    // either way, and a publish can always be re-triggered.
    console.error(`[website:deploy] Failed to call deploy hook ${envVarName}: ${err.message}`);
    return { triggered: false, reason: 'request_failed' };
  }
}

exports.triggerPublishDeploy = () => triggerDeployHook('WEBSITE_PUBLISH_DEPLOY_HOOK_URL');
exports.triggerPreviewDeploy = () => triggerDeployHook('WEBSITE_PREVIEW_DEPLOY_HOOK_URL');
exports.getPreviewUrl = () => process.env.WEBSITE_PREVIEW_URL || null;
