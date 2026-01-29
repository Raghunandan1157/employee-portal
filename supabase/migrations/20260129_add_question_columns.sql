-- Add columns for in-app question feature
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS response_data JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_question_asked TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Comment explaining usage
COMMENT ON COLUMN employees.response_data IS 'Stores JSON responses to in-app questions, e.g., {"monthly_target": "500000", "notes": ""}';
COMMENT ON COLUMN employees.last_question_asked IS 'The last question text shown to the user';
COMMENT ON COLUMN employees.last_response_at IS 'When the user last responded to a question';
