#!/usr/bin/env python3
"""
external-models.py - Multi-model integration script
Provides integration with OpenAI models for supplementary analysis
"""

import os
import sys
import json
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def call_openai_model(model, prompt, max_tokens=2000):
    """Call OpenAI API with specified model"""
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        print("Error: OPENAI_API_KEY not found in environment")
        return None
    
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    
    data = {
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens
    }
    
    try:
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers=headers,
            json=data
        )
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']
    except Exception as e:
        print(f"Error calling OpenAI API: {e}")
        return None

def main():
    if len(sys.argv) < 3:
        print("Usage: python external-models.py <phase> <prompt>")
        print("Phases: research, planning, testing")
        sys.exit(1)
    
    phase = sys.argv[1]
    prompt = sys.argv[2]
    
    # Model mapping based on phase
    model_map = {
        'research': 'gpt-4o',
        'planning': 'o1-preview',
        'testing': 'gpt-4o'
    }
    
    if phase not in model_map:
        print(f"Error: Unknown phase '{phase}'. Available: {list(model_map.keys())}")
        sys.exit(1)
    
    model = model_map[phase]
    print(f"Calling {model} for {phase} phase...")
    
    result = call_openai_model(model, prompt)
    if result:
        print(f"\n=== {model.upper()} Response ===")
        print(result)
    else:
        print("Failed to get response from external model")
        sys.exit(1)

if __name__ == "__main__":
    main()