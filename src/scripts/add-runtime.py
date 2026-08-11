import os
import re

def process_route(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Check if file uses bcrypt or prisma (db)
    uses_node_apis = 'bcrypt' in content or "from '@/lib/db'" in content or 'db.' in content
    
    # Check if runtime is already set
    if "export const runtime" in content:
        return False
    
    if not uses_node_apis:
        return False
    
    # Add runtime directive after 'use server' or 'use client' or first line
    lines = content.split('\n')
    insert_idx = 0
    
    # Skip 'use server' or 'use client' directives
    for i, line in enumerate(lines):
        if line.strip() in ("'use server'", '"use server"', "'use client'", '"use client"'):
            insert_idx = i + 1
        else:
            break
    
    # Insert runtime directive
    lines.insert(insert_idx, "export const runtime = 'nodejs'")
    
    new_content = '\n'.join(lines)
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        return True
    return False

count = 0
for root, dirs, files in os.walk('src/app/api'):
    for f in files:
        if f == 'route.ts':
            path = os.path.join(root, f)
            if process_route(path):
                count += 1
                print(f'  Updated: {path}')

print(f'\nTotal route files updated: {count}')
