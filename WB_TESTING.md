1. Introduction
   White-box testing, also called clear-box, glass-box, or structural testing, is a software testing
   approach that evaluates a program by examining its internal code structure, logic, and
   implementation details. Unlike black-box testing, which focuses on inputs and outputs, white-box
   testing verifies whether the internal workings of the system behave as expected. Testers need
   knowledge of programming and access to the source code. It is commonly applied during unit testing
   and integration testing, where source code is directly available.
2. Characteristics - Focuses on how the program works internally, not just what it produces. - Derived from control flow, data flow, and logic paths. - Requires knowledge of code constructs: loops, conditions, functions, and data handling. - Allows measurement of code coverage: how much of the program is exercised by tests. - Can be automated with coverage tools and unit test frameworks.
3. Advantages and Disadvantages
   Advantages: - Detects logic errors that black-box testing may miss. - Ensures all paths and branches are executed at least once. - Supports code optimization by identifying redundant or dead code. - Useful for early bug detection during development. - Provides measurable coverage metrics (e.g., statement or branch coverage).
   Disadvantages: - Requires technical knowledge of programming. - Time-consuming for large or complex applications. - May miss errors related to missing requirements. - Expensive if attempted at the system level rather than unit level. - Not effective on its own; must be combined with black-box testing for completeness.
4. White-Box Testing Techniques (with Examples)
   4.1 Statement Coverage:
   Ensures every line of code executes at least once.
   Example:
   def add(a, b):
   result = a + b
   print(result)
   return result
   Page 1 of 3
   STES400: Software Testing 4

Page 2 of 3

Test Case: add(2, 3) ensures all three lines execute.

4.2 Branch Coverage (Decision Coverage):
Ensures both true and false conditions of every decision are tested.
Example:
def is_even(n):
if n % 2 == 0:
return True
else:
return False

Test Cases: is_even(4) covers True branch, is_even(5) covers False branch.

4.3 Condition Coverage:
Each boolean condition inside a decision is tested independently.
Example:
def check_conditions(a, b):
if a > 0 and b > 0:
return 'Both positive'
return 'Not both positive'

Test Cases: (a=1, b=1) → True/True; (a=1, b=-1) → True/False; (a=-1, b=1) → False/True; (a=-1, b=-1) →
False/False.

4.4 Path Coverage:
Ensures every possible path through the program executes at least once.
Example:
def categorize(n):
if n > 0:
if n % 2 == 0:
return 'Positive even'
else:
return 'Positive odd'
else:
return 'Zero or negative'

Test Cases: n=4 (Positive even), n=3 (Positive odd), n=0 (Zero/negative).

STES400: Software Testing 4  
4.5 Loop Testing:
Tests loops for off-by-one and boundary errors.
Example:
def sum_numbers(n):
total = 0
for i in range(n):
total += i
return total
Test Cases: - n=0 (loop runs 0 times) - n=1 (loop runs once) - n=5 (loop runs multiple times) - n=1000 (tests performance at high limit) 5. Best Practices - Combine white-box with black-box testing for maximum effectiveness. - Focus on critical paths instead of chasing 100% coverage. - Automate testing and integrate coverage tools into CI/CD pipelines. - Regularly refactor test cases when code changes. - Record and track coverage results to demonstrate progress. 6. Summary
White-box testing ensures that the internal code structure of software is correct and efficient. It uses
techniques like statement, branch, condition, path, and loop coverage to maximize defect detection.
With practical examples, it becomes easier to understand how each technique is applied in real code.
While powerful, white-box testing must be complemented with black-box testing to ensure full
requirements coverage.
