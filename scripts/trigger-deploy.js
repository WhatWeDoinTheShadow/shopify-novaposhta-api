import axios from "axios";

const DEPLOY_HOOK = "https://api.render.com/deploy/srv-d4avun49c44c738r2beg?key=tDaniQRd5Js";

console.log("🚀 Triggering Render Deploy...");

try {
    const res = await axios.post(DEPLOY_HOOK);
    if (res.status >= 200 && res.status < 300) {
        console.log("✅ Deployment triggered successfully!");
        console.log("Check your Render dashboard for progress.");
    } else {
        console.log("⚠️ Unexpected status:", res.status);
    }
} catch (err) {
    console.error("❌ Failed to trigger deploy:", err.message);
    if (err.response) {
        console.error("Data:", err.response.data);
    }
}
