import os
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original = content
    
    # Check if file has console calls
    if 'console.' not in content:
        return False
    
    # Add import if not present
    if 'import { logger } from' not in content:
        # Add import after first import line or at top
        lines = content.split('\n')
        for i, line in enumerate(lines):
            if line.startswith('import '):
                lines.insert(i, "import { logger } from '@/lib/logger'")
                break
        content = '\n'.join(lines)
    
    # Replace console.error, console.warn, console.log with logger equivalents
    content = re.sub(r'console\.error\(', 'logger.error(', content)
    content = re.sub(r'console\.warn\(', 'logger.warn(', content)
    content = re.sub(r'console\.log\(', 'logger.info(', content)
    
    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

# Process all API route files
count = 0
for root, dirs, files in os.walk('src/app/api'):
    for f in files:
        if f.endswith('.ts'):
            path = os.path.join(root, f)
            if process_file(path):
                count += 1
                print(f'  Updated: {path}')

# Process components
for root, dirs, files in os.walk('src/components'):
    for f in files:
        if f.endswith('.tsx') or f.endswith('.ts'):
            path = os.path.join(root, f)
            if process_file(path):
                count += 1
                print(f'  Updated: {path}')

# Process hooks
for root, dirs, files in os.walk('src/hooks'):
    for f in files:
        if f.endswith('.ts') or f.endswith('.tsx'):
            path = os.path.join(root, f)
            if process_file(path):
                count += 1
                print(f'  Updated: {path}')

print(f'\nTotal files updated: {count}')
