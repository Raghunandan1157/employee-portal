-- Add new columns to employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branch(id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
