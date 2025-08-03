#!/bin/bash
# create-project.sh - Create new project from template
# Usage: ./create-project.sh "project-name" "project-type" [destination-path]

PROJECT_NAME=$1
PROJECT_TYPE=$2  # web, api, data, mobile, desktop
DEST_PATH=${3:-"../"}

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_TYPE" ]; then
    echo "Usage: $0 'project-name' 'project-type' [destination-path]"
    echo "Project types: web, api, data, mobile, desktop, generic"
    exit 1
fi

TEMPLATE_DIR="$(dirname "$0")/.."
NEW_PROJECT_PATH="$DEST_PATH/$PROJECT_NAME"

echo "Creating new project: $PROJECT_NAME"
echo "Type: $PROJECT_TYPE"
echo "Destination: $NEW_PROJECT_PATH"

# Create project directory
mkdir -p "$NEW_PROJECT_PATH"

# Copy template files
cp -r "$TEMPLATE_DIR/.claude" "$NEW_PROJECT_PATH/"
cp -r "$TEMPLATE_DIR/scripts" "$NEW_PROJECT_PATH/"
cp -r "$TEMPLATE_DIR/templates" "$NEW_PROJECT_PATH/"
cp "$TEMPLATE_DIR/SETUP.md" "$NEW_PROJECT_PATH/"
cp "$TEMPLATE_DIR/WORKFLOW.md" "$NEW_PROJECT_PATH/"
cp "$TEMPLATE_DIR/.env.template" "$NEW_PROJECT_PATH/"
cp "$TEMPLATE_DIR/.gitmessage" "$NEW_PROJECT_PATH/"

# Customize CLAUDE.md based on project type
case $PROJECT_TYPE in
    "web")
        sed 's/Multi-agent development system/Web application development/' "$TEMPLATE_DIR/CLAUDE.md" > "$NEW_PROJECT_PATH/CLAUDE.md"
        echo "RESEARCH_FOCUS=\"UI/UX patterns, accessibility, performance\"" >> "$NEW_PROJECT_PATH/.env.template"
        ;;
    "api")
        sed 's/Multi-agent development system/API development/' "$TEMPLATE_DIR/CLAUDE.md" > "$NEW_PROJECT_PATH/CLAUDE.md"
        echo "RESEARCH_FOCUS=\"API design patterns, security, scalability\"" >> "$NEW_PROJECT_PATH/.env.template"
        ;;
    "data")
        sed 's/Multi-agent development system/Data science project/' "$TEMPLATE_DIR/CLAUDE.md" > "$NEW_PROJECT_PATH/CLAUDE.md"
        echo "RESEARCH_FOCUS=\"Data sources, ML algorithms, statistical methods\"" >> "$NEW_PROJECT_PATH/.env.template"
        ;;
    *)
        cp "$TEMPLATE_DIR/CLAUDE.md" "$NEW_PROJECT_PATH/"
        ;;
esac

# Create project-specific README
cat > "$NEW_PROJECT_PATH/README.md" << EOF
# $PROJECT_NAME

A $PROJECT_TYPE project using the multi-agent development system.

## Quick Start

1. Configure environment:
   \`\`\`bash
   cp .env.template .env
   # Edit .env with your API keys
   \`\`\`

2. Start development:
   \`\`\`bash
   ./scripts/workflow-orchestrator.sh "$PROJECT_NAME" "Your project description"
   \`\`\`

## Project Type: $PROJECT_TYPE

This project is configured for $PROJECT_TYPE development with specialized agent personas and workflows.

See [SETUP.md](SETUP.md) and [WORKFLOW.md](WORKFLOW.md) for detailed instructions.
EOF

# Initialize git repository
cd "$NEW_PROJECT_PATH"
git init
git add .
git commit -m "[SETUP] [INITIALIZATION]: Initial project setup with multi-agent system

Agent: System Administrator  
Phase: Initialization
Model: N/A

- Copied multi-agent template for $PROJECT_TYPE project
- Configured project-specific settings
- Ready for research phase

Quality Score: N/A
Reviewed by: Template System"

echo "✅ Project created successfully!"
echo "📁 Location: $NEW_PROJECT_PATH"
echo "🚀 Next steps:"
echo "   1. cd $NEW_PROJECT_PATH"
echo "   2. cp .env.template .env && edit .env"
echo "   3. ./scripts/workflow-orchestrator.sh '$PROJECT_NAME' 'Your project description'"