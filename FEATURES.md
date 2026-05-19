# URIS Platform Features & Usage Guide

Welcome to the URIS Feature and Operations Guide. This document details the core functionalities of the URIS application, how to use them, and the underlying logic that drives the intelligence engine.

---

## 🔑 Role-Based Access Control (RBAC)

URIS operates on a strict hierarchical access control system:

| Role | Dashboard Type | Key Capabilities |
|---|---|---|
| **Core Admin** | Admin Dashboard | Full system control, approve users, override scores, manage deadlines, edit tasks, view audit logs. |
| **Technical / Operations / Research Lead** | Admin Dashboard | Assign tasks, view team capacity heatmap, trigger task pause/block actions, delete tasks. |
| **Program Manager** | Admin Dashboard | View dashboards, monitor capacity and workloads, view reports. |
| **Intern (Tech / Ops / Research)** | Intern Dashboard | Declare weekly availability, update task progress, view their own scores. |
| **Observer / Collaborator Lead** | Specialized View | View-only dashboard access or task collaboration fields. |

---

## 📊 Feature Modules & How to Use Them

### 1. Team Heat Capacity Heatmap (Availability Heatmap)
Displays the aggregate availability and workload of teams on a daily basis. 
* **Who sees it:** All non-intern roles (Admin, Leads, Managers).
* **How to read it:** 
  * Rows represent **Teams** (rather than individual interns) dynamically aggregated from the database.
  * Columns show **Monday through Friday** blocks.
  * The **Best Performing Team** of the week is automatically highlighted in **green** with a crown emoji (`👑`) and clear hover labels.
  * Other teams are displayed in gold tones scaled by their daily capacity scores.

### 2. Task Assignment & Overload Warning Banner
When a Lead or Admin creates a task, the system analyzes the selected assignee's workload in real-time.
* **How to use it:**
  1. Navigate to the **Task Monitor** page (`/tasks`) and click **New Task**.
  2. Select an assignee from the dropdown.
  3. If the intern's Capacity Score is `< 40` or their Task Load Index (TLI) is `> 5`, a warning banner instantly appears.
  4. The Lead can review the warning but retains the final decision/override authority to proceed with the assignment.

### 3. Task Deletion with Score Integrity
Leads and Admins can delete incorrectly assigned or redundant tasks.
* **How to use it:**
  1. On the **Task Monitor** page, click on a task to expand it.
  2. Click the **Delete** icon (`Trash2`).
  3. **Score Integrity Safeguard:** Deleting a task performs a soft delete in the database (`deletedAt`). This ensures the task's historical details do not affect the intern's Credibility, Capacity, or Performance (RPI) calculations.

### 4. Tri-Daily Google Form Reminders
To automate updates, the system generates customized mock Google Forms every 3 days.
* **How it works:**
  * A background cron scheduler triggers every 3 days.
  * It creates system alerts for every active intern containing a pre-filled, personalized Google Form URL.
  * Interns click the URL in their notification feed to update their task progress, specify availability, and upload reports.

### 5. Personal Branding & Public Portfolio
Interns can showcase their verified accomplishments to external recruiters.
* **How to use it:**
  1. Interns edit their profile details (Bio, LinkedIn, Skills) on the **Public Portfolio** editor page (`/portfolio-edit`).
  2. The page renders a unique public URL (`/portfolio/<slug>`) and a downloadable **QR Code** for physical resumes.
  3. **Showcase:** The public portfolio page automatically displays the intern's completed tasks, complexity ratings, and verified skills certified by STEMONEF.

### 6. Availability Declarations & Deadlines
Interns declare their availability weekly.
* **How to use it:**
  1. Interns go to `/availability` to submit their hours, continuous free block limits, and busy blocks.
  2. **Exam Week Penalty:** Toggling "Exam Week" applies an automatic `-30` penalty to the Capacity Score for that week.
  3. **Deadline Management:** Admins can adjust the weekly cutoff time (default: Monday 11:00 AM) from the Admin panel.

### 7. Interactive Ambient Background (Starfield)
The application layout floats over a responsive, multi-layered particle starfield.
* **How it responds:**
  1. **Hover Physics:** Moving the mouse cursor over the viewport repels nearby beads/particles. Once the cursor moves away, the particles return to their natural coordinates via a spring-back equation.
  2. **3D Depth Parallax:** Scrolling the page shifts particles at different vertical speeds based on their size/radius (larger particles scroll faster), creating an illusion of visual depth.
  3. **Twinkling & Drifting:** Particles twinkle and float on a slow drift path dynamically, wrapping around the boundaries.

