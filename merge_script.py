#!/usr/bin/env python3
"""
Merge script for Templates Display Feature
Commits changes in worktree and merges to main branch
"""

import subprocess
import sys
from pathlib import Path

def run_command(cmd, cwd=None, check=True):
    """Run a command and return output"""
    print(f"Running: {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if check and result.returncode != 0:
        print(f"❌ Command failed with code {result.returncode}")
        sys.exit(1)
    return result

def main():
    worktree_path = r"c:\Users\adiga\projects\asok-is.worktrees\agents-template-reflection-and-data-display"
    main_repo_path = r"C:\Users\adiga\projects\asok-is"
    topic_branch = "agents/template-reflection-and-data-display"
    base_branch = "main"
    
    print("=" * 60)
    print("MERGE: Templates Display Feature")
    print("=" * 60)
    
    # Step 1: Check status
    print("\n📋 Step 1: Checking status in current worktree")
    run_command("git status", cwd=worktree_path)
    
    # Step 2: Add all changes
    print("\n📝 Step 2: Staging all changes")
    run_command("git add -A", cwd=worktree_path)
    
    # Step 3: Commit
    print("\n💾 Step 3: Creating commit")
    commit_msg = """feat: implement Excel templates display on dashboard

- Add backend service for parsing Excel template files
- Create new /api/v1/reports/templates endpoint
- Add AllTemplatesOut schema for template data
- Create TemplatesDisplay React component
- Add useGetAllTemplatesQuery hook to API slice
- Integrate templates display on Dashboard page
- Load 4 Excel templates automatically on dashboard init
- Support pagination, responsive design, error handling
- Add comprehensive documentation (6 files)

Templates now display in tabbed view on Dashboard with:
- Шаблон Метрик (metrics template)
- Матрица Рисков (risk matrix)
- Детальный Отчет по Метрикам (quality report)
- Качество Системы по Времени (system quality over time)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"""
    
    run_command(f'git commit -m "{commit_msg}"', cwd=worktree_path, check=False)
    
    # Step 4: Verify commit
    print("\n✅ Step 4: Verifying commit")
    run_command("git log --oneline -1", cwd=worktree_path)
    
    # Step 5: Merge to main
    print("\n🔀 Step 5: Merging to main branch")
    run_command(f"git merge {topic_branch}", cwd=main_repo_path)
    
    # Step 6: Verify merge
    print("\n✨ Step 6: Verifying merge")
    run_command("git status", cwd=main_repo_path)
    run_command("git log --oneline -3", cwd=main_repo_path)
    
    # Step 7: Verify topic branch is ancestor
    print("\n🎯 Step 7: Verifying topic branch is merged")
    run_command(f"git merge-base --is-ancestor {topic_branch} HEAD", cwd=main_repo_path)
    
    print("\n" + "=" * 60)
    print("✅ MERGE COMPLETED SUCCESSFULLY!")
    print("=" * 60)
    print("\nTemplates Display Feature is now merged to main branch.")
    print("All changes are preserved and ready for deployment.")

if __name__ == "__main__":
    main()
