-- Drop old users table
DROP TABLE IF EXISTS users;

-- Create employees table
CREATE TABLE employees (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_name TEXT NOT NULL,
    employee_id TEXT UNIQUE NOT NULL,
    email TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert sample employees
INSERT INTO employees (employee_name, employee_id) VALUES
    ('Rajesh Kumar', 'EMP001'),
    ('Priya Sharma', 'EMP002'),
    ('Amit Patel', 'EMP003'),
    ('Sneha Reddy', 'EMP004'),
    ('Vikram Singh', 'EMP005');

-- Enable Row Level Security (optional but recommended)
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust as needed for your security requirements)
CREATE POLICY "Allow all operations" ON employees FOR ALL USING (true) WITH CHECK (true);
