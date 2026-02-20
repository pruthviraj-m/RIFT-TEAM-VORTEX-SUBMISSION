from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import base64
import io
import time
import logging
from datetime import timedelta
import numpy as np
from matplotlib.patches import Patch
from collections import Counter

app = Flask(__name__)
CORS(app, origins=['http://127.0.0.1:5500', 'http://localhost:5500', 'http://127.0.0.1:3000', 'http://localhost:3000'])
logging.basicConfig(level=logging.DEBUG)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'Server is running'})

def detect_cycles(G):
    cycles = []
    try:
        all_cycles = list(nx.simple_cycles(G))
        for cycle in all_cycles:
            if 3 <= len(cycle) <= 5:
                cycle_sorted = sorted(cycle)
                if cycle_sorted not in cycles:
                    cycles.append(cycle_sorted)
    except Exception as e:
        app.logger.error(f"Cycle detection error: {e}")
    return cycles

def detect_fan_in(df, hours=72):
    rings = []
    receivers = df['receiver_id'].unique()
    
    for receiver in receivers:
        receiver_txs = df[df['receiver_id'] == receiver].sort_values('timestamp')
        if len(receiver_txs) >= 4:
            time_window = (receiver_txs['timestamp'].iloc[-1] - receiver_txs['timestamp'].iloc[0]).total_seconds() / 3600
            if time_window <= hours:
                senders = receiver_txs['sender_id'].unique().tolist()
                if len(senders) >= 3:
                    rings.append({
                        'type': 'fan_in',
                        'aggregator': receiver,
                        'senders': senders,
                        'transaction_count': len(receiver_txs)
                    })
    return rings

def detect_fan_out(df, hours=72):
    rings = []
    senders = df['sender_id'].unique()
    
    for sender in senders:
        sender_txs = df[df['sender_id'] == sender].sort_values('timestamp')
        if len(sender_txs) >= 4:
            time_window = (sender_txs['timestamp'].iloc[-1] - sender_txs['timestamp'].iloc[0]).total_seconds() / 3600
            if time_window <= hours:
                receivers = sender_txs['receiver_id'].unique().tolist()
                if len(receivers) >= 3:
                    rings.append({
                        'type': 'fan_out',
                        'sender': sender,
                        'receivers': receivers,
                        'transaction_count': len(sender_txs)
                    })
    return rings

def is_merchant_account(account_id):
    if not isinstance(account_id, str):
        return False
    
    if account_id.startswith('ACC_02'):
        return True
    
    if 'MERCHANT' in account_id.upper():
        return True
    
    return False

def is_smurf_account(account_id):
    if not isinstance(account_id, str):
        return False
    return 'SMURF' in account_id.upper()

@app.route('/upload', methods=['POST'])
def upload():
    try:
        start_time = time.time()
        app.logger.debug("Received upload request")
        
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
            
        file = request.files['file']
        app.logger.debug(f"File received: {file.filename}")
        
        df = pd.read_csv(file)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        total_transactions = len(df)
        app.logger.debug(f"CSV loaded with {total_transactions} rows")
        
        required_cols = ['sender_id', 'receiver_id', 'timestamp', 'amount']
        missing = [col for col in required_cols if col not in df.columns]
        if missing:
            return jsonify({'error': f'Missing columns: {missing}'}), 400
        
        all_senders = set(df['sender_id'].unique())
        all_receivers = set(df['receiver_id'].unique())
        all_accounts = all_senders.union(all_receivers)
        
        total_unique_accounts = len(all_accounts)
        app.logger.debug(f"Unique senders: {len(all_senders)}")
        app.logger.debug(f"Unique receivers: {len(all_receivers)}")
        app.logger.debug(f"TOTAL UNIQUE ACCOUNTS: {total_unique_accounts}")
        
        merchant_accounts = set()
        for acc in all_accounts:
            if is_merchant_account(acc):
                merchant_accounts.add(acc)
        
        app.logger.debug(f"Merchant accounts found: {sorted(list(merchant_accounts))}")
        app.logger.debug(f"Merchant count: {len(merchant_accounts)}")
        
        G = nx.from_pandas_edgelist(df, 'sender_id', 'receiver_id', create_using=nx.DiGraph())
        
        cycles = detect_cycles(G)
        fan_in_rings = detect_fan_in(df)
        fan_out_rings = detect_fan_out(df)
        
        app.logger.debug(f"Found {len(cycles)} cycles")
        app.logger.debug(f"Found {len(fan_in_rings)} fan-in rings")
        app.logger.debug(f"Found {len(fan_out_rings)} fan-out rings")
        
        fraud_rings = []
        ring_counter = 0
        fraud_accounts = set()
        
        for cycle in cycles:
            if len(cycle) >= 3:
                ring_counter += 1
                ring_id = f"RING_{ring_counter:03d}"
                fraud_rings.append({
                    "ring_id": ring_id,
                    "member_accounts": cycle,
                    "pattern_type": "cycle",
                    "risk_score": 95.0,
                    "member_count": len(cycle)
                })
                fraud_accounts.update(cycle)
                app.logger.debug(f"Added cycle ring {ring_counter}: {cycle}")
        
        for ring in fan_in_rings:
            members = list(set(ring['senders'] + [ring['aggregator']]))
            if len(members) >= 3:
                ring_counter += 1
                ring_id = f"RING_{ring_counter:03d}"
                fraud_rings.append({
                    "ring_id": ring_id,
                    "member_accounts": members,
                    "pattern_type": "fan_in",
                    "risk_score": 85.0,
                    "member_count": len(members)
                })
                fraud_accounts.update(members)
                app.logger.debug(f"Added fan-in ring {ring_counter}: {members}")
        
        for ring in fan_out_rings:
            members = list(set([ring['sender']] + ring['receivers']))
            if len(members) >= 3:
                ring_counter += 1
                ring_id = f"RING_{ring_counter:03d}"
                fraud_rings.append({
                    "ring_id": ring_id,
                    "member_accounts": members,
                    "pattern_type": "fan_out",
                    "risk_score": 85.0,
                    "member_count": len(members)
                })
                fraud_accounts.update(members)
        
        suspicious_accounts = []
        
        for account in fraud_accounts:
            if account in merchant_accounts:
                continue
            
            patterns = []
            
            for cycle in cycles:
                if account in cycle:
                    patterns.append('cycle')
                    break
            
            for ring in fan_in_rings:
                if account == ring['aggregator']:
                    patterns.append('aggregator')
                elif account in ring['senders']:
                    patterns.append('smurf_sender')
            
            for ring in fan_out_rings:
                if account == ring['sender']:
                    patterns.append('distributor')
                elif account in ring['receivers']:
                    patterns.append('receiver')
            
            if 'cycle' in patterns:
                score = 95.0
            elif 'aggregator' in patterns:
                score = 90.0
            elif 'distributor' in patterns:
                score = 88.0
            elif 'smurf_sender' in patterns:
                score = 85.0
            else:
                score = 80.0
            
            ring_id = "NONE"
            for ring in fraud_rings:
                if account in ring['member_accounts']:
                    ring_id = ring['ring_id']
                    break
            
            suspicious_accounts.append({
                "account_id": account,
                "suspicion_score": score,
                "detected_patterns": list(set(patterns)),
                "ring_id": ring_id
            })
        
        suspicious_accounts.sort(key=lambda x: x['suspicion_score'], reverse=True)
        
        fraud_count = len(suspicious_accounts)
        merchant_count = len(merchant_accounts)
        normal_count = total_unique_accounts - fraud_count - merchant_count
        
        app.logger.debug(f"FINAL COUNTS:")
        app.logger.debug(f"  Total Accounts: {total_unique_accounts}")
        app.logger.debug(f"  🔴 FRAUD: {fraud_count}")
        app.logger.debug(f"  ⚪ MERCHANTS: {merchant_count}")
        app.logger.debug(f"  🟢 NORMAL: {normal_count}")
        
        plt.figure(figsize=(20, 14), facecolor='black')
        
        if G.number_of_nodes() > 0:
            if G.number_of_nodes() > 200:
                degrees = dict(G.degree())
                top_nodes = sorted(degrees, key=degrees.get, reverse=True)[:200]
                G_viz = G.subgraph(top_nodes)
            else:
                G_viz = G
            
            pos = nx.spring_layout(G_viz, k=2, iterations=50, seed=42)
            
            ring_membership = Counter()
            for ring in fraud_rings:
                for account in ring['member_accounts']:
                    ring_membership[account] += 1
            
            node_colors = []
            node_sizes = []
            
            fraud_set = {acc['account_id'] for acc in suspicious_accounts}
            repeat_count = 0
            single_ring_count = 0
            
            for node in G_viz.nodes():
                if node in merchant_accounts:
                    node_colors.append('#ffffff')
                    node_sizes.append(250)
                elif node in fraud_set:
                    if ring_membership.get(node, 0) > 1:
                        node_colors.append('#ffaa00')
                        node_sizes.append(350)
                        repeat_count += 1
                    else:
                        node_colors.append('#ff3333')
                        node_sizes.append(300)
                        single_ring_count += 1
                else:
                    node_colors.append('#33ff33')
                    node_sizes.append(200)
            
            nx.draw_networkx_nodes(G_viz, pos, node_color=node_colors, 
                                  node_size=node_sizes, alpha=0.9)
            nx.draw_networkx_edges(G_viz, pos, edge_color='#444444', 
                                  arrows=True, arrowsize=8, width=0.5, alpha=0.3)
            nx.draw_networkx_labels(G_viz, pos, font_size=5, font_color='white', 
                                   font_weight='bold')
            
            legend_elements = [
                Patch(facecolor='#ff3333', label=f'🔴 Single Ring ({single_ring_count})'),
                Patch(facecolor='#ffaa00', label=f'🟡 Repeat Offender ({repeat_count})'),
                Patch(facecolor='#ffffff', label=f'⚪ Merchants ({merchant_count})'),
                Patch(facecolor='#33ff33', label=f'🟢 Normal ({normal_count})')
            ]
            plt.legend(handles=legend_elements, loc='upper right', 
                      facecolor='#222222', labelcolor='white', framealpha=0.9,
                      fontsize=10)
            
            plt.title(f'Transaction Network - {total_unique_accounts} Total Accounts', 
                     color='white', size=16, pad=20, fontweight='bold')
        else:
            plt.text(0.5, 0.5, 'No graph data available', color='white', 
                    size=16, ha='center', va='center')
        
        plt.axis('off')
        plt.tight_layout()
        
        img = io.BytesIO()
        plt.savefig(img, format='png', facecolor='black', dpi=150, 
                   bbox_inches='tight', pad_inches=0.5)
        img.seek(0)
        plt.close()
        
        graph_base64 = base64.b64encode(img.getvalue()).decode()
        
        processing_time = time.time() - start_time
        
        result = {
            "suspicious_accounts": suspicious_accounts,
            "fraud_rings": fraud_rings,
            "summary": {
                "total_transactions": total_transactions,
                "total_accounts_analyzed": total_unique_accounts,
                "suspicious_accounts_flagged": fraud_count,
                "fraud_rings_detected": len(fraud_rings),
                "merchant_accounts_detected": merchant_count,
                "normal_accounts": normal_count,
                "repeat_offenders": repeat_count,
                "single_ring_members": single_ring_count,
                "processing_time_seconds": round(processing_time, 2)
            },
            "graph": graph_base64
        }
        
        app.logger.debug(f"RETURNING RESULT: {result['summary']}")
        return jsonify(result)
        
    except Exception as e:
        app.logger.error(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)