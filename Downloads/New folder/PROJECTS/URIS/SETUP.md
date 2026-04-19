# Person B — Setup & Integration Guide
# ─────────────────────────────────────────────────────────────────────────────

## 1. Backend — Add to .env

PERSON_A_API_URL=http://localhost:5000
PLANE_BASE_URL=https://plane.yourcompany.com/api/v1
PLANE_API_KEY=your_plane_api_key_here
PLANE_WORKSPACE_SLUG=your-workspace-slug
PLANE_PROJECT_ID=your-project-uuid

## 2. Extend Prisma Schema

# Copy the model definitions from prisma/schema_additions.prisma
# and paste them at the bottom of your existing schema.prisma.
# Then add these relations to the Intern model:
#   tasks         Task[]
#   credibility   CredibilityScore?
#   capacityScore CapacityScore?

# Run migration:
npx prisma migrate dev --name add_personB_models

## 3. Add routes to app.js

# See src/app_additions.js — copy those 6 lines into Person A's app.js

## 4. Frontend setup (if starting fresh)

npm create vite@latest uris-dashboard -- --template react
cd uris-dashboard
npm install axios

# Tailwind setup
npm install tailwindcss @tailwindcss/vite
# Add to vite.config.js:
#   import tailwindcss from '@tailwindcss/vite'
#   plugins: [react(), tailwindcss()]
# Add to src/index.css:
#   @import "tailwindcss";

# .env for frontend
echo "VITE_API_URL=http://localhost:5000" > .env
echo "VITE_OPENPROJECT_URL=https://openproject.yourcompany.com" >> .env

## 5. File placement

# Backend files go into:
#   src/services/taskService.js
#   src/services/credibilityService.js
#   src/services/capacityService.js
#   src/services/alertService.js
#   src/controllers/tasksController.js       (split from controllers.js)
#   src/controllers/credibilityController.js (split from controllers.js)
#   src/controllers/alertsController.js      (split from controllers.js)
#   src/routes/taskRoutes.js                 (split from routes.js)
#   src/routes/credibilityRoutes.js          (split from routes.js)
#   src/routes/alertRoutes.js                (split from routes.js)

# Frontend files go into:
#   src/components/WhoIsFreePanel.jsx
#   src/components/AlertsPanel.jsx
#   src/components/TaskMonitoringPanel.jsx
#   src/pages/LeadDashboard.jsx

## 6. Build order (follow this strictly)

# Week 1:
#   1. Add Prisma models → migrate
#   2. Add .env variables
#   3. taskService.js — sync + TLI + stale detection
#   4. tasksController.js + taskRoutes.js
#   5. Test GET /tasks/overview in Postman
#   6. WhoIsFreePanel.jsx — verify data shows in browser

# Week 2:
#   7. credibilityService.js
#   8. credibilityController.js + credibilityRoutes.js
#   9. Test GET /credibility/get?internId=xxx
#  10. alertService.js — blocker + reassignment alerts
#  11. alertsController.js + alertRoutes.js
#  12. Test GET /alerts
#  13. AlertsPanel.jsx

# Week 3:
#  14. capacityService.js — confirm Person A's GET /performance/get is live
#  15. Test computeFinalCapacity() for one intern
#  16. TaskMonitoringPanel.jsx
#  17. LeadDashboard.jsx — assemble all panels

# Week 4:
#  18. PATCH /alerts/:id/resolve — add resolve button to AlertsPanel
#  19. OpenProject iframe in GanttEmbed
#  20. End-to-end test with Person A: full pipeline run
