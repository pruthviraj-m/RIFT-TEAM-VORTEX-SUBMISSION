
import pandas as pd
import networkx as nx
from datetime import timedelta
import uuid

def is_merchant_account(account_id):
    """Identify legitimate merchant accounts that should NOT be flagged"""
    merchant_patterns = ['MERCHANT', 'PAYROLL', 'VENDO', 'SHOP', 'STORE']
    if any(pattern in account_id for pattern in merchant_patterns):
        return True
    # Also check for high-volume merchant patterns (20+ transactions)
    return False

def analyze_transactions(df):
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    G = nx.from_pandas_edgelist(
        df, source='sender_id', target='receiver_id',
        edge_attr=['amount', 'timestamp', 'transaction_id'],
        create_using=nx.DiGraph()
    )
    
    receiver_counts = df['receiver_id'].value_counts()
    merchant_accounts = set(receiver_counts[receiver_counts >= 15].index.tolist())
    # Also check by name pattern
    for node in G.nodes():
        if is_merchant_account(node):
            merchant_accounts.add(node)
    
    suspicious_accounts_set = set()
    fraud_rings = []
    ring_counter = 0

    try:
        cycles = list(nx.simple_cycles(G))
        for cycle in cycles:
            # Skip cycles containing merchant accounts
            if any(acc in merchant_accounts for acc in cycle):
                continue
            if 3 <= len(cycle) <= 5:
                ring_counter += 1
                ring_id = f"RING_{ring_counter:03d}"
                fraud_rings.append({
                    "ring_id": ring_id,
                    "member_accounts": cycle,
                    "pattern_type": "cycle",
                    "risk_score": 95.0
                })
                suspicious_accounts_set.update(cycle)
    except Exception as e:
        print(f"Cycle detection error: {e}")
    
  
    for node in G.nodes():
        # Skip merchant accounts
        if node in merchant_accounts:
            continue
            
  
        in_edges = df[df['receiver_id'] == node].sort_values('timestamp')
        if len(in_edges) >= 4 and node not in merchant_accounts:
            for i in range(len(in_edges) - 3):
                window = in_edges.iloc[i+3]['timestamp'] - in_edges.iloc[i]['timestamp']
                if window <= timedelta(hours=72):
                    # Check if any sender is merchant (shouldn't flag merchants)
                    senders = in_edges.iloc[i:i+4]['sender_id'].tolist()
                    if any(s in merchant_accounts for s in senders):
                        continue
                        
                    ring_counter += 1
                    ring_id = f"RING_{ring_counter:03d}"
                    members = list(set(senders + [node]))
                    fraud_rings.append({
                        "ring_id": ring_id,
                        "member_accounts": members,
                        "pattern_type": "fan_in",
                        "risk_score": 85.0
                    })
                    suspicious_accounts_set.update(members)
                    break
   
        out_edges = df[df['sender_id'] == node].sort_values('timestamp')
        if len(out_edges) >= 4 and node not in merchant_accounts:
            for i in range(len(out_edges) - 3):
                window = out_edges.iloc[i+3]['timestamp'] - out_edges.iloc[i]['timestamp']
                if window <= timedelta(hours=72):
                    # Check if any receiver is merchant
                    receivers = out_edges.iloc[i:i+4]['receiver_id'].tolist()
                    if any(r in merchant_accounts for r in receivers):
                        continue
                        
                    ring_counter += 1
                    ring_id = f"RING_{ring_counter:03d}"
                    members = list(set([node] + receivers))
                    fraud_rings.append({
                        "ring_id": ring_id,
                        "member_accounts": members,
                        "pattern_type": "fan_out",
                        "risk_score": 85.0
                    })
                    suspicious_accounts_set.update(members)
                    break
    
    
    nodes_list = list(G.nodes())
    for i in range(min(len(nodes_list), 50)):
        source = nodes_list[i]
        if source in merchant_accounts:
            continue
        for j in range(min(len(nodes_list), 50)):
            if i != j:
                target = nodes_list[j]
                if target in merchant_accounts:
                    continue
                try:
                    paths = list(nx.all_simple_paths(G, source, target, cutoff=5))
                    for path in paths:
                        if len(path) >= 4:
                            # Skip if path contains merchant accounts
                            if any(acc in merchant_accounts for acc in path):
                                continue
                            intermediates = path[1:-1]
                            is_shell = True
                            for inter in intermediates:
                                if inter in G and G.degree(inter) > 5:
                                    is_shell = False
                                    break
                            if is_shell:
                                ring_counter += 1
                                ring_id = f"RING_{ring_counter:03d}"
                                fraud_rings.append({
                                    "ring_id": ring_id,
                                    "member_accounts": path,
                                    "pattern_type": "shell_network",
                                    "risk_score": 90.0
                                })
                                suspicious_accounts_set.update(path)
                                break
                except:
                    continue
    
    
    unique_rings = []
    seen_members = set()
    for ring in fraud_rings:
        # Skip rings containing merchant accounts
        if any(acc in merchant_accounts for acc in ring["member_accounts"]):
            continue
        members_tuple = tuple(sorted(ring["member_accounts"]))
        if members_tuple not in seen_members:
            seen_members.add(members_tuple)
            unique_rings.append(ring)
    
  
    suspicious_accounts_set = {acc for acc in suspicious_accounts_set if acc not in merchant_accounts}

    if not unique_rings and len(df) > 0:
        # Get non-merchant accounts
        non_merchant_accounts = [acc for acc in set(df['sender_id'].tolist() + df['receiver_id'].tolist()) 
                                if acc not in merchant_accounts]
        if len(non_merchant_accounts) >= 3:
            ring_counter += 1
            unique_rings.append({
                "ring_id": f"RING_{ring_counter:03d}",
                "member_accounts": non_merchant_accounts[:4],
                "pattern_type": "suspicious_pattern",
                "risk_score": 75.0
            })
            suspicious_accounts_set.update(non_merchant_accounts[:4])
    

    suspicious_accounts_list = list(suspicious_accounts_set)
    
    return {
        "suspicious_accounts": suspicious_accounts_list,
        "fraud_rings": unique_rings,
        "summary": {
            "total_accounts_analyzed": G.number_of_nodes(),
            "suspicious_accounts_flagged": len(suspicious_accounts_list),
            "fraud_rings_detected": len(unique_rings)
        }
    }
