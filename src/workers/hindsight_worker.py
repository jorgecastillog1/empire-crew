#!/usr/bin/env python3
# Hindsight Worker - Consolidacion nocturna
import requests
import json
import os
from datetime import datetime

API_BASE = os.environ.get('API_BASE', 'http://localhost:3000')

def consolidate():
    print(f'[{datetime.now()}] Iniciando consolidacion...')
    try:
        res = requests.post(f'{API_BASE}/api/supervisor', json={
            'action': 'consolidate',
            'agentId': 'system',
            'companyId': 'all',
        }, timeout=30)
        print(f'Resultado: {res.json()}')
    except Exception as e:
        print(f'Error: {e}')

def run_forgetting():
    print(f'[{datetime.now()}] Aplicando curvas de olvido...')
    try:
        res = requests.post(f'{API_BASE}/api/supervisor', json={
            'action': 'forget',
            'agentId': 'system',
        }, timeout=30)
        print(f'Resultado: {res.json()}')
    except Exception as e:
        print(f'Error: {e}')

if __name__ == '__main__':
    consolidate()
    run_forgetting()
    print('Worker completado.')