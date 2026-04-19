// ─────────────────────────────────────────────────────────────────────────────
// ADD THESE LINES TO YOUR EXISTING app.js (Person A's file)
// Find where she mounts her routes and add yours below them.
// ─────────────────────────────────────────────────────────────────────────────

// Person B route imports — add these near the top with other requires
const taskRoutes        = require('./routes/taskRoutes');
const credibilityRoutes = require('./routes/credibilityRoutes');
const alertRoutes       = require('./routes/alertRoutes');

// Person B route mounts — add these below Person A's route mounts
app.use('/tasks',       taskRoutes);
app.use('/credibility', credibilityRoutes);
app.use('/alerts',      alertRoutes);


// ─────────────────────────────────────────────────────────────────────────────
// ADD THESE TO YOUR .env FILE
// ─────────────────────────────────────────────────────────────────────────────

// PERSON_A_API_URL=http://localhost:5000          # Person A's server (same server = same port)
// PLANE_BASE_URL=https://plane.yourcompany.com/api/v1
// PLANE_API_KEY=your_plane_api_key_here
// PLANE_WORKSPACE_SLUG=your-workspace
// PLANE_PROJECT_ID=your-project-id
