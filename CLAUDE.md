# Employee Portal - Project Notes

## Database Information

- **Supabase Project**: demo project (tndwzftilgkhzxseiszj)
- **Region**: South Asia (Mumbai)

## Data Mappings & Aliases

### Branch Name Aliases
When importing employee data, these branch names should be treated as equivalent:

| CSV Value | Database Branch Name |
|-----------|---------------------|
| Kodangal(Vikarabad) | KODANGAL |

### Mobile Number Formats
Some mobile numbers have "91" prefix (country code), some don't. The search handles both formats automatically.

### Special Branches
- **Head Office** (ID: 5) - For corporate/head office employees
- **Corporate Office** (ID: 6) - For corporate office employees

## Table Structure

```
STATE → REGION → DISTRICT → BRANCH → EMPLOYEES
```

### Employees Table Columns
- `id` (UUID, auto-generated)
- `employee_name` (text)
- `employee_id` (text, e.g., "NM1106")
- `email` (text, nullable - filled when user logs in with Google)
- `role` (text, e.g., "ABM", "BM", "DM", "FO")
- `mobile` (text)
- `branch_id` (foreign key to branch)
- `created_at` (timestamp)

## CSV Import Files

- `branch.csv` - Contains branch hierarchy (State, Region, District, Branch)
- `masters_contacts.csv` - Contains employee details with "Parent" column linking to branch
- `employee_template.csv` - Template for adding new employees (use this format for updates)

## Import Script

Run `python3 import_data.py` to import data from CSV files.

## Google OAuth

- Client ID: 828442976315-29947njoflscn4u45rn6en4upa48aa52.apps.googleusercontent.com
- Authorized origins: http://localhost:3000, http://localhost:8080

## Running the Server

```bash
python3 server.py
```
Opens automatically at http://localhost:3000/login.html

## Login Flow

1. User clicks Google Sign-In
2. If email not found in database → shows "Search by" options:
   - **Employee ID** (e.g., NM1234)
   - **Mobile Number** (e.g., 9876543210)
   - **Name** (e.g., Rajesh Kumar)
3. User searches and selects their profile
4. Email is saved to their employee record
5. Next login → goes straight to profile (no search needed)
