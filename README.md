# NetApp License 비교기

NetApp ONTAP CLI 로그에서 `(system license show)` 출력 구간을 찾아 시리얼 번호, Owner, License 이름을 정리하고 장비 간 license 차이를 비교하는 포터블 웹 도구입니다.

## 실행 방법

Windows에서는 `run.bat`을 더블클릭하면 기본 브라우저로 실행됩니다.

macOS/Linux에서는 터미널에서 아래처럼 실행할 수 있습니다.

```sh
sh run.sh
```

또는 `index.html`을 브라우저에서 직접 열어도 됩니다. 별도 서버나 설치가 필요 없습니다.

## 사용 방법

- CLI 로그를 직접 붙여넣거나 `Upload`로 `.txt`, `.log`, `.out` 파일을 불러옵니다.
- 검색과 필터로 Owner, Serial, License를 좁혀봅니다.
- `Excel 추출`을 누르면 현재 필터 결과 기준의 Detail/Matrix가 `.xlsx` 파일로 저장됩니다.
- Matrix 시트에서 장비별 보유 여부가 다른 License 셀은 빨간색으로 표시됩니다.
- `장비 간 비교`에서 기준 장비와 대상 장비를 선택하고 `비교하기`를 누릅니다.

비교 결과에서 `+License`는 대상 장비에 추가해야 하는 license, `-License`는 대상 장비에서 빠져야 하는 license입니다.

## 파싱 기준

- 사용자가 `license show` 명령어를 오타로 입력해도 바로 아래의 `(system license show)` 줄을 기준으로 출력 구간을 찾습니다.
- `1-81-0000000000000452031000042` 형식의 시리얼은 앞부분과 leading zero를 제거해 `452031000042`로 표시합니다.
- `952252001305` 같은 일반 시리얼은 그대로 표시합니다.
- 같은 Serial Number가 여러 번 나뉘어 나오면 하나로 병합하고 License를 로그 순서대로 누적합니다.
- `Owner: none`과 실제 owner가 있는 항목은 서로 다른 배지로 표시합니다.
- Owner 필터는 `aaaaa-01`, `aaaaa-02`를 `aaaaa`로 묶어서 표시합니다.
- License는 `Package` 테이블의 첫 번째 컬럼만 수집합니다.
- `25 entries were displayed.` 같은 출력 요약 문구는 license로 수집하지 않습니다.
