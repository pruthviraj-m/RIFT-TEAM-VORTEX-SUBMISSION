import pandas as pd
import networkx as nx

def validate_csv_structure(df):
    required = ['transaction_id', 'sender_id', 'receiver_id', 'amount', 'timestamp']
    missing = [col for col in required if col not in df.columns]
    return len(missing) == 0, missing

def get_graph_metrics(G):
    return {
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "density": nx.density(G),
        "is_directed": G.is_directed()
    }

def find_strongly_connected_components(G):
    return list(nx.strongly_connected_components(G))

def calculate_transaction_velocity(df, account_id, hours=72):
    account_txs = df[(df['sender_id'] == account_id) | (df['receiver_id'] == account_id)]
    if len(account_txs) < 2:
        return 0
    time_span = (account_txs['timestamp'].max() - account_txs['timestamp'].min()).total_seconds() / 3600
    return len(account_txs) / max(time_span, 1)

def flag_merchant_accounts(df, threshold=100):
    receivers = df.groupby('receiver_id')['amount'].agg(['count', 'sum'])
    return receivers[receivers['count'] > threshold].index.tolist()


# from datetime import timedelta

# def filter_by_time(df, hours):
#     df = df.copy()
#     df["timestamp"] = df["timestamp"].astype("datetime64[ns]")
#     max_time = df["timestamp"].max()
#     min_time = max_time - timedelta(hours=hours)
#     return df[df["timestamp"] >= min_time]

# def transaction_counts(df):
#     counts = {}
#     for s, r in zip(df["sender_id"], df["receiver_id"]):
#         counts[s] = counts.get(s, 0) + 1
#         counts[r] = counts.get(r, 0) + 1
#     return counts