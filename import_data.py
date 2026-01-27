#!/usr/bin/env python3
"""
Data Import Script for Employee Portal
Imports branches and employees from CSV files into Supabase
"""

import csv
import requests
import json

# Supabase Configuration
SUPABASE_URL = 'https://tndwzftilgkhzxseiszj.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuZHd6ZnRpbGdraHp4c2Vpc3pqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTIyNzA5MiwiZXhwIjoyMDg0ODAzMDkyfQ.UibQMtlXyuWnzqct-xJnviFw7GwnVjYTniSoYF5UTls'

HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': f'Bearer {SUPABASE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

def api_call(method, endpoint, data=None):
    """Make API call to Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    response = None

    if method == 'GET':
        response = requests.get(url, headers=HEADERS)
    elif method == 'POST':
        response = requests.post(url, headers=HEADERS, json=data)
    elif method == 'DELETE':
        response = requests.delete(url, headers=HEADERS)
    elif method == 'PATCH':
        response = requests.patch(url, headers=HEADERS, json=data)

    if response.status_code >= 400:
        print(f"Error {response.status_code}: {response.text[:200]}")
        return None

    try:
        return response.json() if response.text else []
    except:
        return []

def clear_tables():
    """Clear existing data from all tables"""
    print("\n[1/6] Clearing existing data...")

    # Clear in reverse order of dependencies
    tables_with_conditions = [
        ('employees', 'id=neq.00000000-0000-0000-0000-000000000000'),
        ('branch', 'id=gt.0'),
        ('district', 'id=gt.0'),
        ('region', 'id=gt.0'),
        ('state', 'id=gt.0')
    ]

    for table, condition in tables_with_conditions:
        url = f"{SUPABASE_URL}/rest/v1/{table}?{condition}"
        response = requests.delete(url, headers=HEADERS)
        print(f"  Cleared {table}: {response.status_code}")

def read_branch_csv():
    """Read branch.csv and return structured data"""
    branches = []
    with open('branch.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            branches.append({
                'branch_id': row['New Branch ID'].strip(),
                'branch_name': row['BRANCH NAME'].strip(),
                'state': row['STATE'].strip(),
                'district': row['DISTRICT'].strip(),
                'region': row['REGION'].strip()
            })
    return branches

def read_contacts_csv():
    """Read masters_contacts.csv and return employee data"""
    employees = []
    with open('masters_contacts.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            employees.append({
                'name': row['Name'].strip(),
                'employee_id': row['Count/ID'].strip(),
                'role': row['Role'].strip(),
                'mobile': row['Mobile'].strip(),
                'parent': row['Parent'].strip()
            })
    return employees

def insert_states(branches):
    """Extract and insert unique states"""
    print("\n[2/6] Inserting states...")

    # Get unique states
    states = list(set(b['state'] for b in branches))
    states.append('CORPORATE')  # Add special state for offices

    state_map = {}
    for state in sorted(states):
        code = state[:3].upper()
        data = {'name': state, 'code': code}  # Let DB auto-generate ID
        result = api_call('POST', 'state', data)
        if result and len(result) > 0:
            state_map[state] = result[0]['id']
            print(f"  Added state: {state} (ID: {result[0]['id']})")

    return state_map

def insert_regions(branches, state_map):
    """Extract and insert unique regions with state links"""
    print("\n[3/6] Inserting regions...")

    # Get unique region-state combinations
    region_state = {}
    for b in branches:
        region = b['region']
        state = b['state']
        if region not in region_state:
            region_state[region] = state

    # Add corporate region
    region_state['CORPORATE'] = 'CORPORATE'

    region_map = {}
    for region, state in sorted(region_state.items()):
        state_id = state_map.get(state)
        if not state_id:
            print(f"  Warning: No state found for {state}, skipping region {region}")
            continue

        code = region[:3].upper()
        data = {'name': region, 'code': code, 'state_id': state_id}
        result = api_call('POST', 'region', data)
        if result and len(result) > 0:
            region_map[region] = result[0]['id']
            print(f"  Added region: {region} (ID: {result[0]['id']})")

    return region_map

def insert_districts(branches, region_map):
    """Extract and insert unique districts with region links"""
    print("\n[4/6] Inserting districts...")

    # Get unique district-region combinations
    district_region = {}
    for b in branches:
        district = b['district']
        region = b['region']
        if district not in district_region:
            district_region[district] = region

    # Add corporate district
    district_region['CORPORATE'] = 'CORPORATE'

    district_map = {}
    for district, region in sorted(district_region.items()):
        region_id = region_map.get(region)
        if not region_id:
            print(f"  Warning: No region found for {region}, skipping district {district}")
            continue

        data = {'name': district, 'region_id': region_id}
        result = api_call('POST', 'district', data)
        if result and len(result) > 0:
            district_map[district] = result[0]['id']
            print(f"  Added district: {district} (ID: {result[0]['id']})")

    return district_map

def insert_branches(branches, district_map):
    """Insert all branches with district links"""
    print("\n[5/6] Inserting branches...")

    branch_map = {}

    # First add special branches for Head Office and Corporate Office
    corporate_district_id = district_map.get('CORPORATE')
    if corporate_district_id:
        special_branches = [
            {'name': 'Head Office', 'district_id': corporate_district_id},
            {'name': 'Corporate Office', 'district_id': corporate_district_id}
        ]

        for sb in special_branches:
            result = api_call('POST', 'branch', sb)
            if result and len(result) > 0:
                branch_map[sb['name']] = result[0]['id']
                print(f"  Added special branch: {sb['name']} (ID: {result[0]['id']})")

    # Insert regular branches
    success_count = 0
    for b in branches:
        district_id = district_map.get(b['district'])
        if not district_id:
            print(f"  Warning: No district found for {b['district']}, skipping branch {b['branch_name']}")
            continue

        data = {'name': b['branch_name'], 'district_id': district_id}
        result = api_call('POST', 'branch', data)
        if result and len(result) > 0:
            branch_map[b['branch_name']] = result[0]['id']
            success_count += 1

    print(f"  Added {success_count} regular branches")
    return branch_map

def insert_employees(employees, branch_map):
    """Insert all employees with branch links"""
    print("\n[6/6] Inserting employees...")

    success_count = 0
    error_count = 0
    no_branch = []

    # Branch name aliases - map alternate names to canonical names
    BRANCH_ALIASES = {
        'Kodangal(Vikarabad)': 'KODANGAL',
        'kodangal(vikarabad)': 'KODANGAL',
    }

    # Create lowercase branch map for case-insensitive matching
    lower_branch_map = {k.lower(): v for k, v in branch_map.items()}

    for i, emp in enumerate(employees):
        # Find branch_id from parent name
        parent = emp['parent']

        # Check for alias first
        if parent in BRANCH_ALIASES:
            parent = BRANCH_ALIASES[parent]

        branch_id = branch_map.get(parent)

        if not branch_id:
            # Try case-insensitive match
            branch_id = lower_branch_map.get(parent.lower())

        if not branch_id:
            no_branch.append(f"{emp['name']} -> {parent}")
            error_count += 1
            continue

        data = {
            'employee_name': emp['name'],
            'employee_id': emp['employee_id'],
            'role': emp['role'],
            'mobile': emp['mobile'],
            'branch_id': branch_id
        }

        result = api_call('POST', 'employees', data)
        if result:
            success_count += 1
        else:
            error_count += 1

        # Progress indicator
        if (i + 1) % 100 == 0:
            print(f"  Progress: {i + 1}/{len(employees)} employees processed...")

    print(f"\n  Inserted {success_count} employees")
    if error_count > 0:
        print(f"  Errors/Skipped: {error_count}")
    if no_branch:
        print(f"\n  Employees with no matching branch:")
        for nb in no_branch[:10]:
            print(f"    - {nb}")
        if len(no_branch) > 10:
            print(f"    ... and {len(no_branch) - 10} more")

def main():
    print("=" * 50)
    print("Employee Portal - Data Import Script")
    print("=" * 50)

    # Read CSV files
    print("\nReading CSV files...")
    branches = read_branch_csv()
    employees = read_contacts_csv()
    print(f"  Found {len(branches)} branches")
    print(f"  Found {len(employees)} employees")

    # Clear existing data
    clear_tables()

    # Insert hierarchy
    state_map = insert_states(branches)
    region_map = insert_regions(branches, state_map)
    district_map = insert_districts(branches, region_map)
    branch_map = insert_branches(branches, district_map)

    print(f"\n  Branch map has {len(branch_map)} entries")

    # Insert employees
    insert_employees(employees, branch_map)

    print("\n" + "=" * 50)
    print("Import completed!")
    print("=" * 50)

if __name__ == '__main__':
    main()
