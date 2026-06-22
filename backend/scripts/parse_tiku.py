#!/usr/bin/env python3
"""
一建真题 PDF 批量解析 + 导入工具
用法: python scripts/parse_tiku.py
"""
import os, re, json, sys, time
import pdfplumber, requests

# ─── 配置 ────────────────────────────────────────────────
TK_DIR   = r'C:\Users\24750\jianzan-tiku\TK'
API_BASE = 'http://localhost:3000'

SUBJECT_MAP = [          # (关键字, subject_id)  长关键字优先匹配
    ('建筑工程管理与实务', 1), ('建筑实务', 1), ('《建筑》', 1),
    ('建设工程经济',       2), ('经济',     2),
    ('建设工程项目管理',   3), ('项目管理', 3), ('管理',     3),
    ('建设工程法规及相关知识', 4), ('法规', 4),
]

# ─── 工具函数 ─────────────────────────────────────────────
def detect_subject(text, filename=''):
    # 优先从文件名匹配（避免正文通用词干扰）
    for key, sid in SUBJECT_MAP:
        if key in filename:
            return sid
    # 再从正文前 400 字符匹配长关键字（≥4字）
    header = text[:400]
    for key, sid in SUBJECT_MAP:
        if len(key) >= 4 and key in header:
            return sid
    # 最后兜底：正文前 600 字符 + 任意关键字
    for key, sid in SUBJECT_MAP:
        if key in text[:600]:
            return sid
    return None

def detect_year(text, filename=''):
    m = re.search(r'(20\d{2})\s*年', text[:600])
    if m: return int(m.group(1))
    m = re.search(r'(20\d{2})', filename)
    if m: return int(m.group(1))
    return None

def is_readable(text):
    if not text or len(text) < 300:
        return False
    chinese = sum(1 for c in text if '一' <= c <= '鿿')
    return chinese / max(len(text), 1) > 0.08

def pdf_text(path):
    with pdfplumber.open(path) as pdf:
        pages = []
        for p in pdf.pages:
            t = p.extract_text()
            if t: pages.append(t)
        return '\n'.join(pages)

# ─── 答案段起始位置 ───────────────────────────────────────
def find_answer_start(text):
    patterns = [
        r'\n单项选择题\s*\n\s*1\s*[.、]\s*【答案】',
        r'\n多项选择题\s*\n\s*\d+\s*[.、]\s*【答案】',
        r'20\d{2}年《.+?》真题解析',
        r'20\d{2}年.{1,20}真题解析',
        r'答案及解析',
        r'\n答案解析\n',                        # 2025年格式：答案解析单独一行
        r'\n参考答案\s*\n',                     # 参考答案单独成行（非标题中的"真题及参考答案"）
        r'\n1\s*[.、]\s*【答案】',
        r'\n1\s+答案[：:]\s*[A-E]',            # 2025年答案区："\n1 答案：B"
    ]
    for p in patterns:
        m = re.search(p, text)
        if m: return m.start()
    return -1

# ─── 解析选项 ─────────────────────────────────────────────
def parse_options(raw):
    opts = []
    for m in re.finditer(r'([A-E])\.([^A-E\n]*(?:\n(?![A-E]\.|[一二三四五]、|\d+\s*[.、])[^A-E\n]*)*)', raw):
        content = re.sub(r'\s+', ' ', m.group(2)).strip()
        if content:
            opts.append(f"{m.group(1)}.{content}")
    return opts

# ─── 解析单个题目块 ───────────────────────────────────────
def parse_block(raw):
    lines = [l.strip() for l in raw.split('\n') if l.strip()]
    content_lines, opt_lines = [], []
    in_opts = False
    for line in lines:
        if re.match(r'^[A-E]\.', line):
            in_opts = True
        (opt_lines if in_opts else content_lines).append(line)
    content = re.sub(r'\s+', ' ', ' '.join(content_lines)).strip()
    options = parse_options(' '.join(opt_lines))
    return content, options

# ─── 解析题目段 ───────────────────────────────────────────
def parse_questions(text):
    questions = []

    # 2025年格式：以"第N题 单选题"或"第N题 多选题"标记题型
    sec_2025 = re.compile(r'第\d+题\s+([单多]选题|单选题|多选题|案例分析题)')
    if sec_2025.search(text):
        return parse_2025_questions(text)

    # 识别章节
    sec_re = re.compile(
        r'[一二三四五]\s*[、.，]\s*([单多]项选择题|案例分析题)',
        re.IGNORECASE
    )
    boundaries = list(sec_re.finditer(text))

    if boundaries:
        sections = []
        for i, bnd in enumerate(boundaries):
            label = bnd.group(1)
            q_type = ('multiple' if '多' in label
                      else 'case' if '案例' in label
                      else 'single')
            start = bnd.end()
            end = boundaries[i+1].start() if i+1 < len(boundaries) else len(text)
            sections.append((q_type, text[start:end]))
    else:
        sections = [('single', text)]

    for q_type, sec in sections:
        if q_type == 'case':
            questions.extend(parse_case_section(sec))
        else:
            questions.extend(parse_choice_section(sec, q_type))

    return questions


def parse_2025_questions(text):
    """解析2025年格式：
       第1题 单选题 （共20题...）
       1、题目内容
       A. 选项
       B. 选项
       2、下一题...（同一段内多道题）
    """
    questions = []
    # 找章节标题 "第N题 单选题/多选题/案例题"
    sec_re = re.compile(r'第\d+题\s+([单多][选项]题|案例[分析]*题|案例题)')
    boundaries = list(sec_re.finditer(text))
    if not boundaries:
        return []

    for i, bnd in enumerate(boundaries):
        q_type_str = bnd.group(1)
        q_type = ('multiple' if '多' in q_type_str
                  else 'case' if '案例' in q_type_str
                  else 'single')
        sec_start = bnd.end()
        sec_end = boundaries[i + 1].start() if i + 1 < len(boundaries) else len(text)
        sec = text[sec_start:sec_end]

        if q_type == 'case':
            # 案例题：按题号（2位及以上）拆分
            blocks = re.split(r'\n(?=\d{2,3}[、.]\s*[^\d])', sec)
        else:
            # 单选/多选：按 "N、" 拆分（全角顿号）
            blocks = re.split(r'\n(?=\d{1,3}[、]\s*[^\d])', sec)

        for block in blocks:
            block = block.strip()
            m = re.match(r'^(\d{1,3})[、.]\s*', block)
            if not m:
                continue
            num = int(m.group(1))
            if not (1 <= num <= 200):
                continue
            content, options = parse_block(block[m.end():])
            if content:
                questions.append({'num': num, 'content': content,
                                  'options': options, 'type': q_type})
    return questions

def parse_choice_section(text, q_type):
    qs = []
    blocks = re.split(r'\n(?=\d{1,3}\s*[.、]\s*[^\d])', text)
    for block in blocks:
        block = block.strip()
        m = re.match(r'^(\d{1,3})\s*[.、]\s*', block)
        if not m: continue
        num = int(m.group(1))
        if not (1 <= num <= 200): continue
        content, options = parse_block(block[m.end():])
        if content:
            qs.append({'num': num, 'content': content,
                       'options': options, 'type': q_type})
    return qs

def parse_case_section(text):
    """将案例分析题按案例编号拆分，每个案例作为一道题"""
    qs = []
    # 找案例一、案例二…
    case_re = re.compile(r'案例[一二三四五六]')
    markers = list(case_re.finditer(text))
    if not markers:
        # 无明确案例标题，整体作为一道题
        if len(text.strip()) > 50:
            qs.append({'num': 101, 'content': text.strip(),
                       'options': [], 'type': 'case'})
        return qs

    for i, m in enumerate(markers):
        start = m.start()
        end = markers[i+1].start() if i+1 < len(markers) else len(text)
        block = re.sub(r'\s+', ' ', text[start:end]).strip()
        if block:
            qs.append({'num': 100 + i + 1,
                       'content': block,
                       'options': [],
                       'type': 'case'})
    return qs

# ─── 解析答案段 ───────────────────────────────────────────
def parse_answers(text):
    answers = {}

    def clean_expl(s):
        s = re.sub(r'\s+', ' ', s).strip()
        s = re.sub(r'\s*如果需要.*', '', s).strip()
        s = re.sub(r'\s*---.*',     '', s).strip()
        return s

    # 从解析体中提取答案字母（多种表达方式）
    CHOICE_RE = re.compile(
        r'(?:应选|故选|正确选项是|正确答案是|正确答案为|答案选|答案是|答案为|本题选|选择)\s*([A-E]+(?:[、,，]\s*[A-E])*)'
    )

    def extract_letter(body):
        cm = CHOICE_RE.search(body)
        if cm:
            return re.sub(r'[、,，\s]', '', cm.group(1)).upper()
        return None

    # ① 标准格式：N. 【答案】X\n【解析】...
    p1 = re.compile(
        r'(\d{1,3})\s*[.、]?\s*【答案】\s*([A-E,，、\s]+?)\s*\n\s*【解析】\s*(.+?)'
        r'(?=\n\s*\d{1,3}\s*[.、]?\s*【答案】|\Z)',
        re.DOTALL
    )
    for m in p1.finditer(text):
        num = int(m.group(1))
        ans  = re.sub(r'[，,、\s]', '', m.group(2)).upper()
        answers[num] = {'answer': ans, 'explanation': clean_expl(m.group(3))}

    # ② 仅答案无解析：N. 【答案】X
    p2 = re.compile(r'(\d{1,3})\s*[.、]?\s*【答案】\s*([A-E,，、]+)')
    for m in p2.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            answers[num] = {
                'answer': re.sub(r'[，,、\s]', '', m.group(2)).upper(),
                'explanation': ''
            }

    # ③ 参考答案直接带字母：N.【参考答案】：X（2022管理格式）
    p3 = re.compile(r'(\d{1,3})\s*[.、]?\s*【参考答案】\s*[：:]\s*([A-E,，]+)')
    for m in p3.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            answers[num] = {
                'answer': re.sub(r'[，,\s]', '', m.group(2)).upper(),
                'explanation': ''
            }

    # ④ 参考答案整段（答案嵌在末尾）：N【参考答案】\n...正确选项是X（2022法规）
    p4 = re.compile(
        r'(\d{1,3})\s*[.、]?\s*【参考答案】(.+?)(?=\n\s*\d{1,3}\s*[.、]?\s*【参考答案】|\Z)',
        re.DOTALL
    )
    for m in p4.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            body = m.group(2)
            letter = extract_letter(body)
            if letter:
                answers[num] = {'answer': letter, 'explanation': clean_expl(body)}

    # ⑤ 解析整段（答案嵌在末尾）：N【解析】\n...故本题答案选X（2022经济）
    p5 = re.compile(
        r'(\d{1,3})\s*[.、]?\s*【解析】(.+?)(?=\n\s*\d{1,3}\s*[.、]?\s*【解析】|\n\s*\d{1,3}\s*[.、]?\s*【参考答案】|\Z)',
        re.DOTALL
    )
    for m in p5.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            body = m.group(2)
            letter = extract_letter(body)
            if letter:
                answers[num] = {'answer': letter, 'explanation': clean_expl(body)}

    # ⑥ 带"（答案）"标识：N（答案）\n...选X
    p6 = re.compile(
        r'(\d{1,3})\s*[（(](?:答案|解析)[）)]\s*\n?\s*(.+?)(?=\n\s*\d{1,3}\s*[（(]|\Z)',
        re.DOTALL
    )
    for m in p6.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            body = m.group(2)
            letter = extract_letter(body)
            if letter:
                answers[num] = {'answer': letter, 'explanation': clean_expl(body)}

    # ⑦ 早期年份格式：N.X【解析】文字 或 N.X 文字（2020/2019等）
    #    如 "1.C【解析】本题考查..." 或 "71.BCE 本题考查..."
    p7 = re.compile(
        r'^(\d{1,3})\s*[.、]\s*([A-E]+(?:[、,，][A-E])*)\s*(?:【解析】\s*)?(.+?)'
        r'(?=\n\s*\d{1,3}\s*[.、]\s*[A-E]|\Z)',
        re.MULTILINE | re.DOTALL
    )
    for m in p7.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            ans = re.sub(r'[、,，\s]', '', m.group(2)).upper()
            if 1 <= len(ans) <= 5:  # 合法答案：1-5个字母
                answers[num] = {
                    'answer': ans,
                    'explanation': clean_expl(m.group(3))
                }

    # ⑧ 2025年格式："\nN 答案：X\n解析：..."（N 与答案之间空格）
    p8 = re.compile(
        r'(?:^|\n)(\d{1,3})\s+答案[：:]\s*([A-E]+(?:[、,，][A-E])*)'
        r'(?:\s*\n\s*解析[：:]\s*(.+?))?'
        r'(?=\n\s*\d{1,3}\s+答案[：:]|\Z)',
        re.DOTALL
    )
    for m in p8.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            ans = re.sub(r'[、,，\s]', '', m.group(2)).upper()
            expl = clean_expl(m.group(3) or '')
            answers[num] = {'answer': ans, 'explanation': expl}

    # ⑨ 【第N问】格式案例答案（常见于2025年等格式）
    case_fmt_p = re.compile(
        r'【第(\d+)问】\s*(.*?)(?=【第\d+问】|\Z)',
        re.DOTALL
    )
    case_block_p = re.compile(
        r'(\d+)\s*(?:【第\d+问】.*?)?'
        r'(?=\n\d+\s*【第\d+问】|\Z)',
        re.DOTALL
    )

    # ⑦ 案例参考答案（整体收录）
    case_p = re.compile(
        r'(案例[一二三四五六])\s*(.*?)(?=案例[一二三四五六]|\Z)',
        re.DOTALL
    )
    case_map = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6}
    for m in case_p.finditer(text):
        cn  = m.group(1)[-1]
        idx = case_map.get(cn)
        if idx:
            num = 100 + idx
            if num not in answers:
                body = re.sub(r'\s+', ' ', m.group(2)).strip()
                answers[num] = {'answer': body, 'explanation': ''}

    # ⑩ 数字+【第N问】组合的案例答案（2025年格式：31 【第1问】... 32 【第1问】...）
    case2025_p = re.compile(
        r'(\d{2,3})\s+【第1问】(.+?)(?=\n\d{2,3}\s+【第1问】|\Z)',
        re.DOTALL
    )
    for m in case2025_p.finditer(text):
        num = int(m.group(1))
        if num not in answers:
            body = re.sub(r'\s+', ' ', m.group(2)).strip()
            answers[num] = {'answer': body, 'explanation': ''}

    return answers

# ─── 解析一年题目 ─────────────────────────────────────────
def parse_year_block(text, subject_id, year):
    pos = find_answer_start(text)
    q_text = text[:pos] if pos > 0 else text
    a_text = text[pos:]  if pos > 0 else ''

    questions = parse_questions(q_text)
    answers   = parse_answers(a_text)

    result = []
    for q in questions:
        ans = answers.get(q['num'])
        if not ans or not ans['answer']:
            continue
        score = (1 if q['type'] == 'single'
                 else 2 if q['type'] == 'multiple'
                 else 10)
        result.append({
            'subject_id': subject_id,
            'year':       year,
            'type':       q['type'],
            'seq':        q['num'],
            'content':    q['content'],
            'options':    q['options'],
            'answer':     ans['answer'],
            'explanation':ans['explanation'],
            'score':      score,
        })
    return result

# ─── 答案内嵌格式解析（答案紧跟在选项后面，无集中答案区）─────
def parse_inline_answers(text, subject_id, year):
    """
    处理：题目+选项+【答案】+【解析】全部内嵌在每道题块中的格式。
    """
    result = []
    # 先尝试按章节分（单选/多选）
    sec_re = re.compile(r'[一二三四五]\s*[、.，]\s*([单多]项选择题)', re.IGNORECASE)
    boundaries = list(sec_re.finditer(text))

    if boundaries:
        sections = []
        for i, bnd in enumerate(boundaries):
            label = bnd.group(1)
            q_type = 'multiple' if '多' in label else 'single'
            start = bnd.end()
            end = boundaries[i+1].start() if i+1 < len(boundaries) else len(text)
            sections.append((q_type, text[start:end]))
    else:
        sections = [('single', text)]

    for default_type, sec in sections:
        blocks = re.split(r'\n(?=\d{1,3}\s*[.、]\s*[^\d])', sec)
        for block in blocks:
            block = block.strip()
            m = re.match(r'^(\d{1,3})\s*[.、]\s*', block)
            if not m: continue
            num = int(m.group(1))
            if not (1 <= num <= 200): continue
            rest = block[m.end():]

            # 找内嵌答案（同时支持【答案】和【参考答案】）
            ans_m = re.search(r'【(?:参考)?答案】\s*([A-E,，、\s]+)', rest)
            if not ans_m: continue

            answer = re.sub(r'[，,、\s]', '', ans_m.group(1)).upper()

            # 找内嵌解析
            expl_m = re.search(r'【解析】\s*(.+?)(?=【(?:参考)?答案】|\Z)', rest, re.DOTALL)
            explanation = ''
            if expl_m:
                explanation = re.sub(r'\s+', ' ', expl_m.group(1)).strip()
                explanation = re.sub(r'\s*如果需要.*', '', explanation).strip()

            # 内容+选项在答案之前
            body = rest[:ans_m.start()].strip()
            content, options = parse_block(body)
            if not content: continue

            # 从选项数判断题型
            q_type = default_type
            if len(options) >= 5:
                q_type = 'multiple'

            result.append({
                'subject_id': subject_id,
                'year':       year,
                'type':       q_type,
                'seq':        num,
                'content':    content,
                'options':    options,
                'answer':     answer,
                'explanation':explanation,
                'score':      1 if q_type == 'single' else 2,
            })

    return result

# ─── 解析单个 PDF ─────────────────────────────────────────
def parse_pdf(pdf_path):
    filename = os.path.basename(pdf_path)
    try:
        text = pdf_text(pdf_path)
    except Exception as e:
        return [], f'读取失败: {e}'

    if not is_readable(text):
        return [], '文本无法识别（可能是扫描版或加密）'

    subject_id = detect_subject(text, filename)
    if not subject_id:
        return [], '无法识别科目'

    # 仅对文件名明确标注为合集的文件启用多年路径
    is_multi_year_file = bool(re.search(r'20\d{2}-20\d{2}|合集|历年', filename))

    if is_multi_year_file:
        # 严格匹配年份 + 科目 + 真题 的章节标题
        year_hits = list(re.finditer(
            r'(20\d{2})\s*年[一级建造师《\s]{0,10}.{2,20}真题', text
        ))
        distinct_years = list(dict.fromkeys(m.group(1) for m in year_hits))
        if len(distinct_years) > 1:
            all_qs = []
            for i, m in enumerate(year_hits):
                year  = int(m.group(1))
                start = m.start()
                end   = year_hits[i+1].start() if i+1 < len(year_hits) else len(text)
                qs = parse_year_block(text[start:end], subject_id, year)
                if qs:
                    print(f'      {year}: {len(qs)} 题')
                all_qs.extend(qs)
            return all_qs, None
        elif len(distinct_years) == 1:
            # 多年合集但只有一年的内容可读（其余年份可能是扫描件或字符乱码）
            year_single = int(distinct_years[0])
            start_pos = year_hits[0].start()
            qs = parse_year_block(text[start_pos:], subject_id, year_single)
            if not qs:
                qs = parse_inline_answers(text[start_pos:], subject_id, year_single)
            if qs:
                print(f'      {year_single}: {len(qs)} 题（多年合集仅此年可读）')
                return qs, None

    # 单年路径（默认）
    year = detect_year(text, filename)
    if not year:
        return [], '无法识别年份'

    # 先尝试集中答案区格式
    qs = parse_year_block(text, subject_id, year)
    if qs:
        return qs, None

    # 回退：内嵌答案格式
    qs = parse_inline_answers(text, subject_id, year)
    return qs, None

# ─── 扫描所有 PDF ─────────────────────────────────────────
def collect_pdfs(base_dir):
    pdfs = []
    for root, _, files in os.walk(base_dir):
        for f in files:
            if f.lower().endswith('.pdf'):
                pdfs.append(os.path.join(root, f))
    return sorted(pdfs)

# ─── 导入 API ─────────────────────────────────────────────
def import_to_api(questions):
    if not questions:
        return 0, 0
    resp = requests.post(
        f'{API_BASE}/api/questions/import',
        json={'data': json.dumps(questions, ensure_ascii=False)},
        timeout=60
    )
    data = resp.json()
    return data.get('ok', 0), data.get('fail', 0)

# ─── 主流程 ───────────────────────────────────────────────
def main():
    pdfs = collect_pdfs(TK_DIR)
    print(f'共找到 {len(pdfs)} 个 PDF\n')

    all_questions = []
    seen = set()   # (subject_id, year, type, seq) 去重

    for pdf_path in pdfs:
        name = os.path.basename(pdf_path)
        print(f'[PDF] {name}')
        qs, err = parse_pdf(pdf_path)
        if err:
            print(f'   [SKIP] {err}')
            continue
        before = len(all_questions)
        for q in qs:
            key = (q['subject_id'], q['year'], q['type'], q['seq'])
            if key not in seen:
                seen.add(key)
                all_questions.append(q)
        added = len(all_questions) - before
        print(f'   [OK] 新增 {added} 题（已去重）')

    print(f'\n共解析 {len(all_questions)} 道有效题目，开始导入...\n')

    # 分批导入（每批 200 题）
    BATCH = 200
    total_ok, total_fail = 0, 0
    for i in range(0, len(all_questions), BATCH):
        batch = all_questions[i:i+BATCH]
        ok, fail = import_to_api(batch)
        total_ok   += ok
        total_fail += fail
        print(f'  批次 {i//BATCH+1}: 成功 {ok}，失败 {fail}')

    print(f'\n[完成] 导入成功 {total_ok} 题，失败 {total_fail} 题')

    # 保存解析结果备份
    out = os.path.join(os.path.dirname(__file__), 'parsed_questions.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, ensure_ascii=False, indent=2)
    print(f'[备份] 解析结果已保存到: {out}')

if __name__ == '__main__':
    main()
