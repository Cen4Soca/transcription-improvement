# Bugfix Requirements Document

## Introduction

校閲画面（ReviewPage）で、管理者（ADMIN）以外のユーザー（REVIEWER / TEAM_LEADER）がメディア（音声・動画）を再生できない不具合を修正する。

メディアは `GET /sessions/{sessionId}/media-url` で取得した署名付きURLをプレイヤーに渡すことで再生される。ADMINでは正常に再生できるが、自分のセッション／自チームに正当なアクセス権を持つ非ADMINユーザーが校閲画面を開くと、署名付きURLの取得に失敗し、メディアプレイヤーが表示されず再生できない。

アクセス権を持つReviewer／TeamLeaderが担当セッションのメディアを再生できないことで、校閲作業（音声・動画との同期再生による確認・修正）そのものが非ADMINユーザーに対して機能していない。本修正では、正当なアクセス権を持つ非ADMINユーザーが校閲画面でメディアを再生できるようにしつつ、ADMINの再生とアクセス権のない利用者の遮断は現状どおり維持する。

## Bug Analysis

### Current Behavior (Defect)

非ADMINユーザーがメディアURLエンドポイントを呼び出すと、正当なアクセス権を持つ場合でもURL取得に失敗し、校閲画面でメディアを再生できない。

1.1 WHEN 自分のセッション（直接割り当て）または自チームに割り当てられたセッションに対するアクセス権を持つ REVIEWER が `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system はアクセス拒否（404）を返し、署名付きURLを生成しない

1.2 WHEN 自チームに割り当てられたセッションに対するアクセス権を持つ TEAM_LEADER が `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system はアクセス拒否（404）を返し、署名付きURLを生成しない

1.3 WHEN 正当なアクセス権を持つ非ADMINユーザーが校閲画面を開く THEN the system はメディアURL取得に失敗したためメディアプレイヤーを表示せず、メディアを再生できない

### Expected Behavior (Correct)

正当なアクセス権を持つ非ADMINユーザーに対しては、ADMINと同様に署名付きURLを生成し、校閲画面でメディアを再生できるようにする。

2.1 WHEN 自分のセッション（直接割り当て）または自チームに割り当てられたセッションに対するアクセス権を持つ REVIEWER が `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system SHALL アクセスを許可し、当該セッションのメディアに対する署名付きURLを生成して返す

2.2 WHEN 自チームに割り当てられたセッションに対するアクセス権を持つ TEAM_LEADER が `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system SHALL アクセスを許可し、当該セッションのメディアに対する署名付きURLを生成して返す

2.3 WHEN 正当なアクセス権を持つ非ADMINユーザーが校閲画面を開く THEN the system SHALL 署名付きURLを用いてメディアプレイヤーを表示し、メディアを再生できるようにする

### Unchanged Behavior (Regression Prevention)

ADMINの再生、アクセス権のない利用者の遮断、およびスキャン状態・リソース存在に基づく既存のガードは変更しない。

3.1 WHEN ADMIN が `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system SHALL CONTINUE TO アクセスを許可し、署名付きURLを生成して返す

3.2 WHEN 対象セッションに対するアクセス権を持たない非ADMINユーザーが `GET /sessions/{sessionId}/media-url` を呼び出す THEN the system SHALL CONTINUE TO リソースの存在を隠蔽するため 404 を返す

3.3 WHEN 対象メディアの scanStatus が PENDING（未スキャン）または INFECTED である THEN the system SHALL CONTINUE TO 403 を返し、署名付きURLを生成しない

3.4 WHEN 対象セッションにメディアファイルが存在しない THEN the system SHALL CONTINUE TO 404（メディアファイルが見つからない）を返す

3.5 WHEN 署名付きURLが正常に生成される THEN the system SHALL CONTINUE TO 有効期限付き（既定300秒）かつ現行CSP（`media-src https://*.amazonaws.com`）に適合するホストのURLを返す
