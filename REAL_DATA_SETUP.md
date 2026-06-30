# Real User Data Setup Guide

**Updated**: June 30, 2026  
**Status**: Ready to import actual employee data

---

## Overview

This guide covers:
1. Removing test/fake data
2. Importing actual employee data from your spreadsheet
3. Setting initial passwords
4. Handling password changes on first login

---

## Employee Data to Import

### Total: 23 actual employees

**Core Admin (3)**
- Vikas (official@stemonef.org)
- Kajal Jha (kajaljha@stemonef.org)
- Nithin (nksingh-fci-fo@stemonef.org)

**Research Leads (3)**
- Akshay Ravi (akshay.ravi@stemonef.org)
- Gautam (gj-lead-p-gaia@epochs-stemonef.org)
- Subhashis Dash (subhashisdash-eios@epochs-stemonef.org)

**Operations & Program Management (2)**
- Harini (harini.rv.opsl@stemonef.org) - Operations Lead
- Rakshna.R (programmanagerrak@gmail.com) - Program Manager

**Technical Team**
- Tarkeshwar Sharma (tarkeshwar.sharma@steami.network) - Technical Lead
- ANWESHA (anweshamohapatra11111@gmail.com) - Technical Intern
- SEETA ANANYA (ananyaseeta.stemonef@gmail.com) - Technical Intern
- Ishaan Sen (ishaansenres@gmail.com) - Technical Intern
- Sahil Raj (sahilraj172303@gmail.com) - Technical Intern
- Vaibhav Singh (programmanagervs@gmail.com) - Technical Intern
- Lakshya Luv Mimani (lakshyaluvmimani@proton.me) - Technical Intern

**Research Interns (4)**
- Vishmitha.V.A (vishmithaarupa@gmail.com)
- Shriyanshu Singh (ssh.ep.pg@gmail.com)
- Priyadarshini Palanirajan (ppr.ep.pg@gmail.com)
- Niharika Pandey (np.ep.pg@gmail.com)
- BOPPANA HARSHA VARDHAN RAO (harshavardhanstem1@gmail.com)

**Other Roles (3)**
- Shashi (shashikushwaha@stemonef.org) - Team Member
- Purba Chowdhury (pc.ep.pg@gmail.com) - Past Employee
- Shruthi Kumari (shruti.eios.alpha.evt.sil@gmail.com) - Past Employee

---

## Setup Instructions

### Prerequisites

Ensure you have:
- ✅ Backend running (`npm run dev` in `/backend`)
- ✅ PostgreSQL database connected
- ✅ Database migrations applied (`npx prisma migrate deploy`)
- ✅ Node.js 20+ installed

### Step 1: Run the Import Script

```bash
cd backend

# Run the import script
node scripts/import-actual-users.js
```

**Expected Output:**
```
📊 URIS User Import Script

============================================================

1️⃣  Removing test/fake data...
   ✓ Deleted 1 user(s) with email: admin@uris.com
   ✓ Deleted 1 user(s) with email: rahul@uris.com
   ✓ Deleted 1 user(s) with email: arjun@uris.com

✅ Removed 3 test/fake users

2️⃣  Hashing password (bcrypt, 10 rounds)...
   ✓ Password hashed

3️⃣  Importing actual employee data...
   ✓ official@stemonef.org (CORE_ADMIN)
   ✓ kajaljha@stemonef.org (CORE_ADMIN)
   ✓ akshay.ravi@stemonef.org (RESEARCH_LEAD)
   ... (20 more)

4️⃣  Verifying import...
   ✓ Total users in database: 23

5️⃣  Imported users summary:
   • CORE_ADMIN: 3 users
   • RESEARCH_LEAD: 3 users
   • OPERATIONS_LEAD: 1 user
   ... (more stats)

============================================================

✅ IMPORT COMPLETE!

📝 Important Notes:
   • All passwords set to: "123456"
   • Users MUST change password on first login
   • Test data has been removed
   • 23 actual employees imported

💡 Next steps:
   1. Visit http://localhost:5173/login
   2. Login with any email and password "123456"
   3. Change your password when prompted
```

### Step 2: Verify Import Success

```bash
# Check the database
psql $DATABASE_URL -c "SELECT email, name, role FROM \"User\" ORDER BY name;"

# Should show 23 users with their roles
```

### Step 3: Test Login

1. Open frontend: `http://localhost:5173`
2. Click "Sign In"
3. Use any employee email (e.g., `official@stemonef.org`)
4. Password: `123456`
5. Should be prompted to change password
6. Set new password and login again

---

## Password Management

### Initial Setup
- ✅ All users set to password: `123456`
- ✅ `mustChangePassword` flag set to `true`
- ✅ On first login, modal forces password change

### First Login Flow
1. User enters email/password `123456`
2. System detects `mustChangePassword === true`
3. Redirects to `/force-password-change`
4. User enters new strong password
5. Password updated, flag cleared
6. Redirects to dashboard

### Password Reset
- Users can reset password via `/forgot-password` at any time
- Email sent with secure reset link
- Token valid for 1 hour
- One-time use enforcement

---

## Troubleshooting

### Issue: "Cannot find module 'prisma'"

**Solution:**
```bash
cd backend
npm install
npx prisma generate
```

### Issue: "Database connection failed"

**Solution:**
```bash
# Check DATABASE_URL in .env
cat backend/.env | grep DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1;"
```

### Issue: "Import script failed to run"

**Solution:**
```bash
# Ensure you're in the backend directory
cd backend

# Run with explicit node path
node scripts/import-actual-users.js

# Or check for syntax errors
node -c scripts/import-actual-users.js
```

### Issue: Users not appearing after import

**Solution:**
```bash
# Check if users were actually created
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"User\";"

# Look for specific user
psql $DATABASE_URL -c "SELECT * FROM \"User\" WHERE email = 'official@stemonef.org';"

# Check password field (should be hashed, not plain text)
psql $DATABASE_URL -c "SELECT email, name, password LIKE '$2a%' as is_hashed FROM \"User\" LIMIT 5;"
```

---

## Admin Dashboard Error Fix

If you're seeing an error in the admin dashboard, it's likely due to:

1. **Missing data**: No users in database
2. **Permission issue**: Current user not CORE_ADMIN
3. **Database error**: Connection timeout

### Solution:

```bash
# 1. Verify users imported
psql $DATABASE_URL -c "SELECT COUNT(*) as total_users, COUNT(CASE WHEN role='CORE_ADMIN' THEN 1 END) as admins FROM \"User\";"

# 2. Login as admin (Vikas or Kajal)
# email: official@stemonef.org or kajaljha@stemonef.org
# password: 123456

# 3. Go to Admin dashboard
# Should see all users listed

# 4. If still error, check backend logs
tail -f backend/logs/app.log | grep -i "admin\|error"
```

---

## Verification Checklist

After import, verify:

- [ ] 23 users in database
- [ ] 3 users with CORE_ADMIN role
- [ ] All passwords hashed (start with `$2a` or `$2b`)
- [ ] `mustChangePassword` flag set to true for all
- [ ] No test/fake data remaining
- [ ] Admin can login and see dashboard
- [ ] Password change prompt appears on first login
- [ ] Chat system works (friend requests, messaging)
- [ ] Dashboard loads quickly (< 500ms)

---

## Data Structure

Each imported user has:

| Field | Value |
|-------|-------|
| email | From spreadsheet |
| name | From spreadsheet |
| role | Mapped from role column |
| password | Hashed `123456` |
| status | `active` |
| mustChangePassword | `true` |
| createdAt | Now |

### Role Mapping

| Spreadsheet Role | Database Role |
|------------------|---------------|
| Core Admin | CORE_ADMIN |
| Admin | CORE_ADMIN |
| Research Lead | RESEARCH_LEAD |
| Operations Lead | OPERATIONS_LEAD |
| Technical Lead | TECHNICAL_LEAD |
| Program Manager | OPERATIONS_PROGRAM_MANAGER |
| Research Intern | RESEARCH_INTERN |
| Technical Intern | TECHNICAL_INTERN |
| Team Member | TECHNICAL_INTERN |
| Past Employee | PAST_EMPLOYEE |

---

## What Happens Next

### Day 1: Import & Setup
- ✅ Run import script
- ✅ Verify all users present
- ✅ Test login with default password

### Day 2: First Use
- ✅ Send notification to all users
- ✅ Users login and change passwords
- ✅ Passwords stored securely

### Going Forward
- ✅ Users can reset passwords via "Forgot Password"
- ✅ Admins can manage roles via Admin Dashboard
- ✅ Chat system available for communication
- ✅ Task assignments start

---

## Sample Commands

### Import Script
```bash
node scripts/import-actual-users.js
```

### Verify Users
```bash
psql $DATABASE_URL -c "
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN role='CORE_ADMIN' THEN 1 END) as admins,
    COUNT(CASE WHEN mustChangePassword=true THEN 1 END) as need_pwd_change
  FROM \"User\";
"
```

### Check Specific User
```bash
psql $DATABASE_URL -c "
  SELECT email, name, role, status, mustChangePassword 
  FROM \"User\" 
  WHERE email = 'official@stemonef.org';
"
```

### Count by Role
```bash
psql $DATABASE_URL -c "
  SELECT role, COUNT(*) as count 
  FROM \"User\" 
  GROUP BY role 
  ORDER BY count DESC;
"
```

---

## Admin Credentials After Import

**Default Admin Users** (use password `123456` then change):

| Email | Name | Role |
|-------|------|------|
| official@stemonef.org | Vikas | Core Admin |
| kajaljha@stemonef.org | Kajal Jha | Core Admin |
| nksingh-fci-fo@stemonef.org | Nithin | Core Admin |

After first login and password change, use new credentials.

---

## Rollback (If Needed)

To revert to test data:

```bash
# Delete all users
psql $DATABASE_URL -c "DELETE FROM \"User\";"

# Run seed script (creates test data)
node prisma/seed.js
```

---

## Support

For issues:
1. Check troubleshooting section above
2. Review backend logs: `tail -f backend/logs/app.log`
3. Check database directly: `psql $DATABASE_URL`
4. Verify environment: `.env` file has correct DATABASE_URL

---

## Next Steps

After successful import:

1. ✅ Test login with admin account
2. ✅ Force password change on first login
3. ✅ Navigate to Admin Dashboard
4. ✅ Verify no errors displayed
5. ✅ Test chat system with another user
6. ✅ Verify dashboard performance (< 500ms)

---

**Status**: Ready for production import  
**Confidence**: High (automated script with verification)  
**Time to Complete**: ~5-10 minutes

Let me know if you need help running the import or debugging any issues!
